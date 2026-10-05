BEGIN;
SELECT plan(12);

-- 1. Function existence assertions
SELECT has_function('public', 'get_exercise_benchmarks', ARRAY['uuid', 'date', 'uuid[]', 'text'], 'get_exercise_benchmarks RPC exists with p_pr_mode');
SELECT has_function('public', 'get_exercise_stats', ARRAY['uuid', 'text'], 'get_exercise_stats RPC exists with p_pr_mode');

-- 2. Core benchmarks test: >90-day gap, warmup/drop ignored, master vs custom same name, PR date, RLS / coach auth
DO $$
DECLARE
  v_athlete uuid := gen_random_uuid();
  v_coach_linked uuid := gen_random_uuid();
  v_coach_ended uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();

  v_ex_master uuid;
  v_ex_custom uuid := gen_random_uuid();

  v_w_old uuid := gen_random_uuid();
  v_w_mid uuid := gen_random_uuid();
  v_w_same_day1 uuid := gen_random_uuid();
  v_w_today uuid := gen_random_uuid();

  v_benchmarks record;
  v_stats record;
  v_benchmarks_count int := 0;
  v_stats_count int := 0;
  v_ex_id uuid;
  i int;
BEGIN
  -- Create users
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_athlete, 'athlete_bm@test.com', '{"role":"athlete"}'::jsonb),
    (v_coach_linked, 'coach_linked@test.com', '{"role":"coach"}'::jsonb),
    (v_coach_ended, 'coach_ended@test.com', '{"role":"coach"}'::jsonb),
    (v_other_user, 'other_bm@test.com', '{"role":"athlete"}'::jsonb);

  -- Link coaches: one active, one ended
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status)
  VALUES
    (v_coach_linked, v_athlete, 'active'),
    (v_coach_ended, v_athlete, 'disconnected');

  -- Exercises: pick a master exercise name (e.g. 'Incline Bench Press') and create a custom exercise with same name
  SELECT id INTO v_ex_master FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.exercises (id, user_id, name, equipment, is_master)
  VALUES (v_ex_custom, v_athlete, (SELECT name FROM public.exercises WHERE id = v_ex_master), 'dumbbell', false);

  -- Workouts for athlete:
  -- Old workout: 200 days ago (2026-03-01). >90-day gap!
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w_old, v_athlete, 'Old Session', '2026-03-01 10:00:00+00', '2026-03-01');

  -- Sets on old workout:
  -- Master exercise: Working 120x5 (PR for master)
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_w_old, v_ex_master, 120, 5, 1, 'working');

  -- Custom exercise with same name: Working 95x10 (different PR by id!)
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_w_old, v_ex_custom, 95, 10, 1, 'working');

  -- Mid workout: 30 days ago (2026-08-28).
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w_mid, v_athlete, 'Mid Session', '2026-08-28 10:00:00+00', '2026-08-28');

  -- Sets on mid workout:
  -- Warm-up 225x1 (heavier than working, but MUST BE IGNORED)
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_w_mid, v_ex_master, 225, 1, 1, 'warmup');

  -- Drop set 80x15 (MUST BE IGNORED)
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_w_mid, v_ex_master, 80, 15, 2, 'drop');

  -- Working sets: 100x8, 100x8
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES
    (v_w_mid, v_ex_master, 100, 8, 3, 'working'),
    (v_w_mid, v_ex_master, 100, 8, 4, 'working');

  -- Prior session: 5 days ago (2026-09-22).
  INSERT INTO public.workouts (id, user_id, name, date, workout_date, created_at)
  VALUES (v_w_same_day1, v_athlete, 'Prior Session', '2026-09-22 09:00:00+00', '2026-09-22', '2026-09-22 09:00:00+00');

  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_w_same_day1, v_ex_master, 90, 10, 1, 'working');

  -- Today workout: 2026-09-27
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w_today, v_athlete, 'Today Session', '2026-09-27 10:00:00+00', '2026-09-27');

  -- Impersonate Athlete to test self-read
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete || '"}', true);

  -- 1. Query benchmarks for master exercise on 2026-09-27
  SELECT * INTO v_benchmarks
  FROM public.get_exercise_benchmarks(v_athlete, '2026-09-27'::date, ARRAY[v_ex_master]);

  -- Verify PR:
  -- Must be 120x5 from 200 days ago (2026-03-01), NOT the warmup 225x1!
  IF v_benchmarks.pr_weight <> 120 OR v_benchmarks.pr_reps <> 5 OR v_benchmarks.pr_date <> '2026-03-01'::date THEN
    RAISE EXCEPTION 'Master PR failed: expected 120x5 on 2026-03-01 (ignoring 225x1 warmup), got %x% on %',
      v_benchmarks.pr_weight, v_benchmarks.pr_reps, v_benchmarks.pr_date;
  END IF;

  -- Verify Last:
  -- Must be the session from 2026-09-22 (90x10), with no age cap
  IF v_benchmarks.last_date <> '2026-09-22'::date THEN
    RAISE EXCEPTION 'Master Last date failed: expected 2026-09-22, got %', v_benchmarks.last_date;
  END IF;

  -- Verify custom exercise with same name stays separate by ID:
  SELECT * INTO v_benchmarks
  FROM public.get_exercise_benchmarks(v_athlete, '2026-09-27'::date, ARRAY[v_ex_custom]);

  IF v_benchmarks.pr_weight <> 95 OR v_benchmarks.pr_reps <> 10 OR v_benchmarks.pr_date <> '2026-03-01'::date THEN
    RAISE EXCEPTION 'Custom exercise PR failed: expected 95x10 on 2026-03-01, got %x% on %',
      v_benchmarks.pr_weight, v_benchmarks.pr_reps, v_benchmarks.pr_date;
  END IF;

  -- 2. Authorization: Linked coach can read athlete
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_linked || '"}', true);

  SELECT * INTO v_benchmarks
  FROM public.get_exercise_benchmarks(v_athlete, '2026-09-27'::date, ARRAY[v_ex_master]);

  IF v_benchmarks.pr_weight <> 120 THEN
    RAISE EXCEPTION 'Linked coach should read athlete benchmarks, got %', v_benchmarks.pr_weight;
  END IF;

  SELECT * INTO v_stats
  FROM public.get_exercise_stats(v_athlete)
  WHERE exercise_id = v_ex_master;

  IF v_stats.max_weight <> 120 OR v_stats.pr_date <> '2026-03-01'::date THEN
    RAISE EXCEPTION 'Linked coach should read athlete exercise stats, got % on %', v_stats.max_weight, v_stats.pr_date;
  END IF;

  -- 3. Authorization: Unlinked authenticated user querying athlete gets 0 rows (via workouts RLS)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_other_user || '"}', true);

  SELECT * INTO v_benchmarks
  FROM public.get_exercise_benchmarks(v_athlete, '2026-09-27'::date, ARRAY[v_ex_master]);

  -- Unlinked user gets empty benchmarks (pr_weight IS NULL)
  IF v_benchmarks.pr_weight IS NOT NULL THEN
    RAISE EXCEPTION 'Unlinked user must receive 0 benchmark rows (NULL pr_weight), got: %', v_benchmarks.pr_weight;
  END IF;

  SELECT COUNT(*) INTO v_stats_count
  FROM public.get_exercise_stats(v_athlete);

  IF v_stats_count <> 0 THEN
    RAISE EXCEPTION 'Unlinked user must receive 0 exercise stats rows, got: %', v_stats_count;
  END IF;

  -- 4. Authorization: Coach with ENDED link querying athlete gets 0 rows
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_ended || '"}', true);

  SELECT * INTO v_benchmarks
  FROM public.get_exercise_benchmarks(v_athlete, '2026-09-27'::date, ARRAY[v_ex_master]);

  IF v_benchmarks.pr_weight IS NOT NULL THEN
    RAISE EXCEPTION 'Ended-link coach must receive 0 benchmark rows, got: %', v_benchmarks.pr_weight;
  END IF;

  SELECT COUNT(*) INTO v_stats_count
  FROM public.get_exercise_stats(v_athlete);

  IF v_stats_count <> 0 THEN
    RAISE EXCEPTION 'Ended-link coach must receive 0 exercise stats rows, got: %', v_stats_count;
  END IF;

  -- Reset role to postgres for seeding >200 exercises
  PERFORM set_config('role', 'postgres', true);

  -- 5. stats v2 > 200 rows returned (no LIMIT 200 cap)
  FOR i IN 1..220 LOOP
    v_ex_id := gen_random_uuid();
    INSERT INTO public.exercises (id, user_id, name, is_master)
    VALUES (v_ex_id, v_athlete, format('Stress Exercise %s', i), false);

    INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
    VALUES (v_w_old, v_ex_id, 100, 5, 1, 'working');
  END LOOP;

  SELECT COUNT(*) INTO v_stats_count
  FROM public.get_exercise_stats(v_athlete);

  -- 220 stress exercises + v_ex_master + v_ex_custom = 222 exercises
  IF v_stats_count < 220 THEN
    RAISE EXCEPTION 'Expected get_exercise_stats v2 to return > 200 rows, got: %', v_stats_count;
  END IF;

  -- 6. Verify e1rm mode returns pr_e1rm numeric
  SELECT * INTO v_benchmarks
  FROM public.get_exercise_benchmarks(v_athlete, '2026-09-27'::date, ARRAY[v_ex_master], 'e1rm');

  IF v_benchmarks.pr_e1rm IS NULL OR v_benchmarks.pr_e1rm <= 0 THEN
    RAISE EXCEPTION 'Expected non-null pr_e1rm in e1rm mode, got %', v_benchmarks.pr_e1rm;
  END IF;

  SELECT * INTO v_stats
  FROM public.get_exercise_stats(v_athlete, 'e1rm')
  WHERE exercise_id = v_ex_master;

  IF v_stats.pr_e1rm IS NULL OR v_stats.pr_e1rm <= 0 THEN
    RAISE EXCEPTION 'Expected non-null pr_e1rm in e1rm mode for stats, got %', v_stats.pr_e1rm;
  END IF;
END;
$$;

SELECT pass('get_exercise_benchmarks finds >90-day gap PR and Last');
SELECT pass('Warmup and drop sets are correctly excluded from PR and Last');
SELECT pass('Custom and master exercises with same name stay separate by id');
SELECT pass('Linked coach can read athlete benchmarks and stats');
SELECT pass('Unlinked authenticated user querying athlete gets 0 rows via RLS');
SELECT pass('Ended coach link querying athlete gets 0 rows via RLS');
SELECT pass('get_exercise_stats v2 returns >200 rows without LIMIT 200 truncation');
SELECT pass('PR date is correctly populated in benchmarks and stats v2');
SELECT pass('get_exercise_benchmarks supports p_pr_mode e1rm mode');
SELECT pass('get_exercise_stats supports p_pr_mode e1rm mode');

SELECT * FROM finish();
ROLLBACK;
