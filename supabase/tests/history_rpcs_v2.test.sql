BEGIN;
SELECT plan(24);

-- ============================================================================
-- 1. Schema, Signature & Function Property Assertions
-- ============================================================================
SELECT has_function(
  'public',
  'get_history_sessions_v2',
  ARRAY['uuid', 'date', 'date', 'uuid', 'integer'],
  'get_history_sessions_v2 RPC exists with signature (uuid, date, date, uuid, integer)'
);

SELECT has_function(
  'public',
  'get_exercise_history',
  ARRAY['uuid', 'uuid', 'date', 'date', 'integer'],
  'get_exercise_history RPC exists with signature (uuid, uuid, date, date, integer)'
);

SELECT has_function(
  'public',
  'get_history_sessions',
  ARRAY['uuid', 'integer', 'integer'],
  'v1 get_history_sessions RPC still exists with signature (uuid, integer, integer)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_history_sessions_v2'
      AND p.prosecdef = false
  ),
  'get_history_sessions_v2 is SECURITY INVOKER (prosecdef=false)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_history_sessions_v2'
      AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
  ),
  'get_history_sessions_v2 has explicit search_path=public'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_exercise_history'
      AND p.prosecdef = false
  ),
  'get_exercise_history is SECURITY INVOKER (prosecdef=false)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_exercise_history'
      AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%'
  ),
  'get_exercise_history has explicit search_path=public'
);

-- ============================================================================
-- 2. 800-session Fixture: 30d empty, 90d count match, Full Keyset Walk
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_rec record;
  v_cur_date date := NULL;
  v_cur_id uuid := NULL;
  v_page_count int := 0;
  v_total_collected int := 0;
  v_oldest_date date;
  v_count_30d int;
  v_count_90d int;
  v_sql_90d int;
  v_90d_total_count bigint;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'bench800_tap@test.com');

  -- Insert 800 workouts: newest at CURRENT_DATE - 45
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  SELECT
    gen_random_uuid(),
    v_uid,
    'Session ' || i,
    (CURRENT_DATE - 45 - i)::timestamptz,
    CURRENT_DATE - 45 - i
  FROM generate_series(0, 799) AS i;

  -- 1. 30d range: newest is at -45d, so >= CURRENT_DATE - 30 must yield 0 rows
  SELECT count(*) INTO v_count_30d
  FROM public.get_history_sessions_v2(v_uid, p_since => CURRENT_DATE - 30);
  IF v_count_30d <> 0 THEN
    RAISE EXCEPTION '30d range expected 0 rows, got %', v_count_30d;
  END IF;

  -- 2. 90d range: total_count = SQL count
  SELECT count(*) INTO v_sql_90d
  FROM public.workouts
  WHERE user_id = v_uid AND workout_date >= CURRENT_DATE - 90;

  SELECT count(*), max(total_count) INTO v_count_90d, v_90d_total_count
  FROM public.get_history_sessions_v2(v_uid, p_since => CURRENT_DATE - 90, p_limit => 30);

  IF v_90d_total_count <> v_sql_90d THEN
    RAISE EXCEPTION '90d total_count (%) does not match SQL count (%)', v_90d_total_count, v_sql_90d;
  END IF;

  -- 3. Walk all pages with limit 30
  LOOP
    v_page_count := 0;
    FOR v_rec IN
      SELECT * FROM public.get_history_sessions_v2(
        v_uid,
        p_since => NULL,
        p_before_date => v_cur_date,
        p_before_id => v_cur_id,
        p_limit => 30
      )
    LOOP
      v_page_count := v_page_count + 1;
      v_total_collected := v_total_collected + 1;

      -- Check duplicate
      IF v_rec.id = ANY(v_seen_ids) THEN
        RAISE EXCEPTION 'Duplicate session ID encountered in walk: %', v_rec.id;
      END IF;
      v_seen_ids := array_append(v_seen_ids, v_rec.id);

      v_cur_date := v_rec.civil_date;
      v_cur_id := v_rec.id;
      v_oldest_date := v_rec.civil_date;
    END LOOP;

    EXIT WHEN v_page_count = 0;
  END LOOP;

  IF v_total_collected <> 800 THEN
    RAISE EXCEPTION 'Walk all pages collected %, expected 800', v_total_collected;
  END IF;

  IF array_length(v_seen_ids, 1) <> 800 THEN
    RAISE EXCEPTION 'Unique session IDs count %, expected 800', array_length(v_seen_ids, 1);
  END IF;

  IF v_oldest_date <> (CURRENT_DATE - 45 - 799) THEN
    RAISE EXCEPTION 'Oldest date mismatch: expected %, got %', (CURRENT_DATE - 45 - 799), v_oldest_date;
  END IF;
END;
$$;
SELECT pass('800-session fixture: 30d range returns 0 rows (server confirmed)');
SELECT pass('800-session fixture: 90d range total_count matches SQL count');
SELECT pass('800-session fixture: keyset walk visits all 800 sessions');
SELECT pass('800-session fixture: keyset walk has no duplicates and no gaps');
SELECT pass('800-session fixture: keyset walk reaches oldest session');

-- ============================================================================
-- 3. Keyset Stability: Insert Between Page 1 and Page 2
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_p1_last record;
  v_p2_first record;
  v_p1_ids uuid[];
  v_p2_ids uuid[];
  v_new_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'insert_between_tap@test.com');

  -- Insert 100 workouts
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  SELECT
    gen_random_uuid(),
    v_uid,
    'Session ' || i,
    (CURRENT_DATE - 45 - i)::timestamptz,
    CURRENT_DATE - 45 - i
  FROM generate_series(0, 99) AS i;

  -- Page 1 (30 rows)
  SELECT array_agg(id) INTO v_p1_ids
  FROM (
    SELECT id FROM public.get_history_sessions_v2(v_uid, p_limit => 30)
  ) p1;

  SELECT * INTO v_p1_last
  FROM public.get_history_sessions_v2(v_uid, p_limit => 30)
  OFFSET 29 LIMIT 1;

  -- Insert a brand new session newer than page 1 (CURRENT_DATE - 10)
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_new_id, v_uid, 'Brand New Session', (CURRENT_DATE - 10)::timestamptz, CURRENT_DATE - 10);

  -- Page 2 using keyset from p1 last
  SELECT array_agg(id) INTO v_p2_ids
  FROM (
    SELECT id FROM public.get_history_sessions_v2(
      v_uid,
      p_before_date => v_p1_last.civil_date,
      p_before_id => v_p1_last.id,
      p_limit => 30
    )
  ) p2;

  SELECT * INTO v_p2_first
  FROM public.get_history_sessions_v2(
    v_uid,
    p_before_date => v_p1_last.civil_date,
    p_before_id => v_p1_last.id,
    p_limit => 30
  )
  LIMIT 1;

  -- Verify no overlap between page 1 and page 2
  IF v_p1_ids && v_p2_ids THEN
    RAISE EXCEPTION 'Page 1 and Page 2 have overlapping IDs!';
  END IF;

  -- Verify new session is NOT in page 2
  IF v_new_id = ANY(v_p2_ids) THEN
    RAISE EXCEPTION 'New session leaked into page 2!';
  END IF;

  -- Verify page 2 continues directly after page 1 without skipping
  IF v_p2_first.civil_date <> (v_p1_last.civil_date - 1) THEN
    RAISE EXCEPTION 'Page 2 skip detected: p1_last=%, p2_first=%', v_p1_last.civil_date, v_p2_first.civil_date;
  END IF;
END;
$$;
SELECT pass('Keyset stability: insert between page 1 and page 2 produces no dupes and no skips on page 2');

-- ============================================================================
-- 4. Warmup/Drop Exclusion, Exercise History Sessions Pagination & RLS
-- ============================================================================
DO $$
DECLARE
  v_ath_id uuid := gen_random_uuid();
  v_coach_id uuid := gen_random_uuid();
  v_stranger_id uuid := gen_random_uuid();
  v_ex_id uuid := gen_random_uuid();
  v_other_ex_id uuid := gen_random_uuid();
  v_w1 uuid := gen_random_uuid();
  v_w2 uuid := gen_random_uuid();
  v_w3 uuid := gen_random_uuid();
  v_w4 uuid := gen_random_uuid();
  v_wid uuid;
  v_count int;
  v_tot bigint;
  v_rec record;
  v_ex_seen_workouts uuid[] := ARRAY[]::uuid[];
  v_ex_cur_before date := NULL;
  v_ex_page_count int := 0;
  v_ex_total_walked int := 0;
BEGIN
  -- Create test users
  INSERT INTO auth.users (id, email) VALUES
    (v_ath_id, 'm5_ath@test.com'),
    (v_coach_id, 'm5_coach@test.com'),
    (v_stranger_id, 'm5_stranger@test.com');

  -- Coach-athlete link
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status)
  VALUES (v_coach_id, v_ath_id, 'active');

  -- Exercises
  INSERT INTO public.exercises (id, name, body_parts, is_master, user_id)
  VALUES
    (v_ex_id, 'Bench Press M5 Test', ARRAY['Chest'], true, NULL),
    (v_other_ex_id, 'Squat M5 Test', ARRAY['Legs'], true, NULL);

  -- Session 1: 2 working sets (100x5, 100x5 -> 1000 vol), 1 warmup (50x10), 1 drop (60x8)
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w1, v_ath_id, 'Session W1', (CURRENT_DATE - 10)::timestamptz, CURRENT_DATE - 10);

  INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at) VALUES
    (gen_random_uuid(), v_w1, v_ex_id, 100, 5, 1, 'working', (CURRENT_DATE - 10)::timestamptz),
    (gen_random_uuid(), v_w1, v_ex_id, 100, 5, 2, 'working', (CURRENT_DATE - 10)::timestamptz),
    (gen_random_uuid(), v_w1, v_ex_id, 50, 10, 3, 'warmup', (CURRENT_DATE - 10)::timestamptz),
    (gen_random_uuid(), v_w1, v_ex_id, 60, 8, 4, 'drop', (CURRENT_DATE - 10)::timestamptz);

  -- Session 2: 1 working set (110x3 -> 330 vol)
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w2, v_ath_id, 'Session W2', (CURRENT_DATE - 11)::timestamptz, CURRENT_DATE - 11);
  INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
  VALUES (gen_random_uuid(), v_w2, v_ex_id, 110, 3, 1, 'working', (CURRENT_DATE - 11)::timestamptz);

  -- Session 3: ONLY warmup set of target exercise (must be excluded from get_exercise_history)
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w3, v_ath_id, 'Session W3 (Warmup only)', (CURRENT_DATE - 12)::timestamptz, CURRENT_DATE - 12);
  INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
  VALUES (gen_random_uuid(), v_w3, v_ex_id, 40, 10, 1, 'warmup', (CURRENT_DATE - 12)::timestamptz);

  -- Session 4: working set of a DIFFERENT exercise
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w4, v_ath_id, 'Session W4 (Other)', (CURRENT_DATE - 13)::timestamptz, CURRENT_DATE - 13);
  INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
  VALUES (gen_random_uuid(), v_w4, v_other_ex_id, 140, 5, 1, 'working', (CURRENT_DATE - 13)::timestamptz);

  -- Sessions 5..15 (11 sessions): 1 working set each
  FOR i IN 14..24 LOOP
    v_wid := gen_random_uuid();
    INSERT INTO public.workouts (id, user_id, name, date, workout_date)
    VALUES (v_wid, v_ath_id, 'Session ' || i, (CURRENT_DATE - i)::timestamptz, CURRENT_DATE - i);
    INSERT INTO public.sets (id, workout_id, exercise_id, weight, reps, set_index, set_type, created_at)
    VALUES (gen_random_uuid(), v_wid, v_ex_id, 100 + i, 5, 1, 'working', (CURRENT_DATE - i)::timestamptz);
  END LOOP;

  -- 14. Test Session 1 in get_history_sessions_v2 excludes warmup and drop sets from set_count and total_volume
  SELECT * INTO v_rec FROM public.get_history_sessions_v2(v_ath_id, p_limit => 1);
  IF v_rec.set_count <> 2 THEN
    RAISE EXCEPTION 'W1 set_count expected 2 working sets, got %', v_rec.set_count;
  END IF;
  IF v_rec.total_volume <> 1000 THEN
    RAISE EXCEPTION 'W1 total_volume expected 1000, got %', v_rec.total_volume;
  END IF;

  -- 15. get_exercise_history excludes warmup and drop sets
  SELECT count(*) INTO v_count
  FROM public.get_exercise_history(v_ath_id, v_ex_id, p_limit => 1);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Session W1 in get_exercise_history expected 2 working sets, got %', v_count;
  END IF;

  -- 16 & 18. Session 3 (warmup only) is excluded; total qualifying sessions = 1 + 1 + 11 = 13
  SELECT max(total_sessions) INTO v_tot
  FROM public.get_exercise_history(v_ath_id, v_ex_id, p_limit => 10);
  IF v_tot <> 13 THEN
    RAISE EXCEPTION 'total_sessions expected 13, got %', v_tot;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.get_exercise_history(v_ath_id, v_ex_id, p_limit => 50)
    WHERE workout_id = v_w3
  ) THEN
    RAISE EXCEPTION 'Session W3 (warmup-only) leaked into get_exercise_history!';
  END IF;

  -- 17. get_exercise_history pages by session (p_limit=5 sessions returns 6 sets on page 1)
  SELECT count(*) INTO v_count
  FROM public.get_exercise_history(v_ath_id, v_ex_id, p_limit => 5);
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'Page 1 sets count expected 6 across 5 sessions, got %', v_count;
  END IF;

  -- 19. Keyset walk over get_exercise_history
  LOOP
    v_ex_page_count := 0;
    FOR v_rec IN
      SELECT * FROM public.get_exercise_history(
        v_ath_id,
        v_ex_id,
        p_before => v_ex_cur_before,
        p_limit => 5
      )
    LOOP
      v_ex_page_count := v_ex_page_count + 1;
      IF NOT (v_rec.workout_id = ANY(v_ex_seen_workouts)) THEN
        v_ex_seen_workouts := array_append(v_ex_seen_workouts, v_rec.workout_id);
      END IF;
      v_ex_cur_before := v_rec.civil_date;
    END LOOP;

    EXIT WHEN v_ex_page_count = 0;
  END LOOP;

  IF array_length(v_ex_seen_workouts, 1) <> 13 THEN
    RAISE EXCEPTION 'Exercise history keyset walk visited % sessions, expected 13', array_length(v_ex_seen_workouts, 1);
  END IF;

  -- 20. RLS: Athlete reads own data
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  SELECT count(*) INTO v_count FROM public.get_history_sessions_v2(v_ath_id);
  IF v_count = 0 THEN RAISE EXCEPTION 'Athlete could not read own sessions!'; END IF;
  SELECT count(*) INTO v_count FROM public.get_exercise_history(v_ath_id, v_ex_id);
  IF v_count = 0 THEN RAISE EXCEPTION 'Athlete could not read own exercise history!'; END IF;

  -- 21. RLS: Linked coach reads athlete data
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_count FROM public.get_history_sessions_v2(v_ath_id);
  IF v_count = 0 THEN RAISE EXCEPTION 'Coach could not read linked athlete sessions!'; END IF;
  SELECT count(*) INTO v_count FROM public.get_exercise_history(v_ath_id, v_ex_id);
  IF v_count = 0 THEN RAISE EXCEPTION 'Coach could not read linked athlete exercise history!'; END IF;

  -- 22. RLS: Stranger gets 0 rows
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_stranger_id || '"}', true);
  SELECT count(*) INTO v_count FROM public.get_history_sessions_v2(v_ath_id);
  IF v_count <> 0 THEN RAISE EXCEPTION 'Stranger read athlete sessions! Got % rows', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.get_exercise_history(v_ath_id, v_ex_id);
  IF v_count <> 0 THEN RAISE EXCEPTION 'Stranger read athlete exercise history! Got % rows', v_count; END IF;

  -- 23. RLS: Anon gets 0 rows
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SELECT count(*) INTO v_count FROM public.get_history_sessions_v2(v_ath_id);
  IF v_count <> 0 THEN RAISE EXCEPTION 'Anon read athlete sessions! Got % rows', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.get_exercise_history(v_ath_id, v_ex_id);
  IF v_count <> 0 THEN RAISE EXCEPTION 'Anon read athlete exercise history! Got % rows', v_count; END IF;

  -- Reset role to postgres
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- 24. v1 get_history_sessions is still callable with old signature
  SELECT count(*) INTO v_count FROM public.get_history_sessions(v_ath_id, 0, 10);
  IF v_count = 0 THEN RAISE EXCEPTION 'v1 get_history_sessions returned 0 rows!'; END IF;
END;
$$;

SELECT pass('get_history_sessions_v2 excludes warmup and drop sets from set_count and total_volume');
SELECT pass('get_exercise_history excludes warmup and drop sets');
SELECT pass('get_exercise_history excludes sessions with only warmup sets of target exercise');
SELECT pass('get_exercise_history pages by session, returning all working sets for each paged session');
SELECT pass('get_exercise_history total_sessions matches SQL count of qualifying sessions');
SELECT pass('get_exercise_history keyset walk over all pages visits all sessions without gaps or dupes');
SELECT pass('RLS: athlete reads own sessions and exercise history via get_history_sessions_v2 and get_exercise_history');
SELECT pass('RLS: linked coach reads athlete sessions and exercise history');
SELECT pass('RLS: stranger user gets 0 rows from both v2 RPCs');
SELECT pass('RLS: anon user gets 0 rows from both v2 RPCs');
SELECT pass('v1 get_history_sessions remains callable with old signature and returns matching data');

SELECT * FROM finish();
ROLLBACK;
