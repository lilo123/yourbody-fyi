BEGIN;
SELECT plan(16);

-- 1. Table & Column assertions
SELECT has_table('public', 'workouts', 'workouts table exists');
SELECT has_column('public', 'workouts', 'workout_date', 'workouts table has workout_date column');
SELECT col_not_null('public', 'workouts', 'workout_date', 'workouts.workout_date is NOT NULL');
SELECT col_type_is('public', 'workouts', 'workout_date', 'date', 'workouts.workout_date is type date');
SELECT has_function('public', 'workout_civil_date', ARRAY['timestamp with time zone', 'text'], 'workout_civil_date helper exists');

-- 2. Pure function unit tests for RD-5 civil date derivation
SELECT is(
  public.workout_civil_date('2026-09-26 00:00:00+00'::timestamptz, 'America/Los_Angeles'),
  '2026-09-26'::date,
  'LA user midnight-UTC row -> its UTC date (production shape)'
);

SELECT is(
  public.workout_civil_date('2026-09-26 06:30:00+00'::timestamptz, 'America/Los_Angeles'),
  '2026-09-25'::date,
  'LA row 2026-09-26T06:30Z -> 2026-09-25'
);

SELECT is(
  public.workout_civil_date('2026-09-26 16:00:00+00'::timestamptz, 'Asia/Tokyo'),
  '2026-09-27'::date,
  'Tokyo row 2026-09-26T16:00Z -> 2026-09-27'
);

SELECT is(
  public.workout_civil_date('2026-09-26 00:00:00+00'::timestamptz, 'Asia/Novosibirsk'),
  '2026-09-26'::date,
  'Novosibirsk midnight-UTC -> UTC date'
);

SELECT is(
  public.workout_civil_date('2026-09-26 06:30:00+00'::timestamptz, NULL),
  '2026-09-26'::date,
  'Null timezone falls back to UTC date'
);

SELECT is(
  public.workout_civil_date('2026-09-26 06:30:00+00'::timestamptz, 'Invalid/Zone'),
  '2026-09-26'::date,
  'Invalid timezone falls back to UTC date'
);

-- 3. Trigger tests on workouts table (legacy INSERT, UPDATE, explicit workout_date)
DO $$
DECLARE
  v_user_la uuid := gen_random_uuid();
  v_user_utc7 uuid := gen_random_uuid();
  v_wid_la_mid uuid;
  v_wid_la_time uuid;
  v_wid_exp uuid;
  v_wdate date;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_user_la, 'user_la@test.com', '{"role":"athlete","timezone":"America/Los_Angeles"}'::jsonb),
    (v_user_utc7, 'user_utc7@test.com', '{"role":"athlete","timezone":"Asia/Novosibirsk"}'::jsonb);

  UPDATE public.users SET timezone = 'America/Los_Angeles' WHERE id = v_user_la;
  UPDATE public.users SET timezone = 'Asia/Novosibirsk' WHERE id = v_user_utc7;

  -- Test: Legacy INSERT with midnight UTC for an LA user -> UTC date (production shape)
  INSERT INTO public.workouts (id, user_id, name, date)
  VALUES (gen_random_uuid(), v_user_la, 'LA Midnight Production Shape', '2026-09-26 00:00:00+00')
  RETURNING id, workout_date INTO v_wid_la_mid, v_wdate;

  IF v_wdate <> '2026-09-26'::date THEN
    RAISE EXCEPTION 'Legacy INSERT with midnight UTC for LA user failed: expected 2026-09-26, got %', v_wdate;
  END IF;

  -- Test: Legacy INSERT with explicit time (06:30 UTC = 23:30 PDT previous day) for LA user -> local civil date
  INSERT INTO public.workouts (id, user_id, name, date)
  VALUES (gen_random_uuid(), v_user_la, 'LA Late Night', '2026-09-26 06:30:00+00')
  RETURNING id, workout_date INTO v_wid_la_time, v_wdate;

  IF v_wdate <> '2026-09-25'::date THEN
    RAISE EXCEPTION 'Legacy INSERT with time for LA user failed: expected 2026-09-25, got %', v_wdate;
  END IF;

  -- Test: UPDATE of date to midnight UTC -> UTC date
  UPDATE public.workouts
  SET date = '2026-09-28 00:00:00+00'
  WHERE id = v_wid_la_time
  RETURNING workout_date INTO v_wdate;

  IF v_wdate <> '2026-09-28'::date THEN
    RAISE EXCEPTION 'UPDATE of date to midnight UTC failed: expected 2026-09-28, got %', v_wdate;
  END IF;

  -- Test: Explicit workout_date respected on INSERT
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (gen_random_uuid(), v_user_la, 'Explicit Date Workout', '2026-09-26 00:00:00+00', '2026-09-20'::date)
  RETURNING id, workout_date INTO v_wid_exp, v_wdate;

  IF v_wdate <> '2026-09-20'::date THEN
    RAISE EXCEPTION 'Explicit workout_date not respected on INSERT: expected 2026-09-20, got %', v_wdate;
  END IF;

  -- Test: Explicit workout_date respected on UPDATE
  UPDATE public.workouts
  SET workout_date = '2026-09-19'::date
  WHERE id = v_wid_exp
  RETURNING workout_date INTO v_wdate;

  IF v_wdate <> '2026-09-19'::date THEN
    RAISE EXCEPTION 'Explicit workout_date not respected on UPDATE: expected 2026-09-19, got %', v_wdate;
  END IF;
END;
$$;

SELECT pass('Trigger sets civil date correctly for legacy INSERTs, UPDATEs, and respects explicit workout_date');

-- 4. Unique day constraint rejects second workout for same user and day
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user, 'uniq@test.com', '{"role":"athlete"}'::jsonb);

  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (gen_random_uuid(), v_user, 'First Daily Workout', '2026-09-15 10:00:00+00', '2026-09-15');

  BEGIN
    INSERT INTO public.workouts (id, user_id, name, date, workout_date)
    VALUES (gen_random_uuid(), v_user, 'Second Daily Workout', '2026-09-15 16:00:00+00', '2026-09-15');
    RAISE EXCEPTION 'Duplicate (user_id, workout_date) was accepted unexpectedly!';
  EXCEPTION WHEN unique_violation THEN
    -- Expected unique violation
    NULL;
  END;
END;
$$;

SELECT pass('workouts unique(user_id, workout_date) constraint correctly rejects duplicate day');

-- 5. get_ghost_sets and get_history_sessions expose civil_date
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_wid uuid := gen_random_uuid();
  v_eid uuid;
  v_res_gh record;
  v_res_hist record;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user, 'rpctest@test.com', '{"role":"athlete"}'::jsonb);
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;

  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_wid, v_user, 'RPC Test Workout', '2026-09-10 10:00:00+00', '2026-09-10');

  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_wid, v_eid, 100, 5, 1, 'working');

  -- Query get_history_sessions: verify civil_date
  SELECT * INTO v_res_hist FROM public.get_history_sessions(v_user, 0, 10) LIMIT 1;
  IF v_res_hist.civil_date <> '2026-09-10'::date THEN
    RAISE EXCEPTION 'get_history_sessions did not return expected civil_date: %', v_res_hist.civil_date;
  END IF;

  -- Query get_ghost_sets: verify civil_date and preserved workout_date timestamptz
  SELECT * INTO v_res_gh FROM public.get_ghost_sets(v_user, '2026-09-15'::date) LIMIT 1;
  IF v_res_gh.civil_date <> '2026-09-10'::date THEN
    RAISE EXCEPTION 'get_ghost_sets did not return expected civil_date: %', v_res_gh.civil_date;
  END IF;
  IF v_res_gh.workout_date <> '2026-09-10 10:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'get_ghost_sets did not preserve workout_date timestamptz: %', v_res_gh.workout_date;
  END IF;
END;
$$;

SELECT pass('get_history_sessions exposes civil_date date');
SELECT pass('get_ghost_sets exposes civil_date date and preserves workout_date timestamptz');
SELECT pass('all M2 civil date tests completed');

SELECT * FROM finish();
ROLLBACK;
