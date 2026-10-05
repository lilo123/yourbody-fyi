BEGIN;
SELECT plan(15);

-- ============================================================================
-- 1. Column Existence, Type, NOT NULL, and Default Assertions
-- ============================================================================
SELECT has_column('public', 'users', 'pr_mode', 'users table has pr_mode column');
SELECT col_type_is('public', 'users', 'pr_mode', 'text', 'users.pr_mode is type text');
SELECT col_not_null('public', 'users', 'pr_mode', 'users.pr_mode is NOT NULL');
SELECT col_default_is('public', 'users', 'pr_mode', 'weight', 'users.pr_mode default is weight');

-- ============================================================================
-- 2. Existing Rows Assertion
-- ============================================================================
SELECT is_empty(
  'SELECT id FROM public.users WHERE pr_mode IS NULL OR pr_mode NOT IN (''weight'', ''e1rm'')',
  'All existing users rows have a valid pr_mode'
);

-- ============================================================================
-- 3. New User Defaults Assertion (auth signup trigger & direct insert)
-- ============================================================================
DO $$
DECLARE
  v_uid_auth uuid := gen_random_uuid();
  v_uid_direct uuid := gen_random_uuid();
  v_mode text;
BEGIN
  -- Insert via auth.users (trigger handle_new_user populates public.users)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid_auth, 'new_auth_user_pr@test.com', '{"role":"athlete"}'::jsonb);

  SELECT pr_mode INTO v_mode FROM public.users WHERE id = v_uid_auth;
  IF v_mode <> 'weight' THEN
    RAISE EXCEPTION 'Expected pr_mode = weight via auth signup trigger, got %', v_mode;
  END IF;

  -- Insert directly into public.users without specifying pr_mode
  INSERT INTO auth.users (id, email) VALUES (v_uid_direct, 'new_direct_user_pr@test.com');
  DELETE FROM public.users WHERE id = v_uid_direct;
  INSERT INTO public.users (id, email) VALUES (v_uid_direct, 'new_direct_user_pr@test.com');

  SELECT pr_mode INTO v_mode FROM public.users WHERE id = v_uid_direct;
  IF v_mode <> 'weight' THEN
    RAISE EXCEPTION 'Expected pr_mode = weight via direct table insert, got %', v_mode;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_uid_auth, v_uid_direct);
END;
$$;
SELECT pass('New user rows default pr_mode to weight (auth signup trigger and direct insert)');

-- ============================================================================
-- 4. CHECK Constraint Assertion (accepts 'weight', 'e1rm'; rejects others)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_val text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'chk_user_pr@test.com', '{"role":"athlete"}'::jsonb);

  -- Valid: 'e1rm'
  UPDATE public.users SET pr_mode = 'e1rm' WHERE id = v_uid;
  SELECT pr_mode INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 'e1rm' THEN
    RAISE EXCEPTION 'Failed to update pr_mode to e1rm';
  END IF;

  -- Valid: 'weight'
  UPDATE public.users SET pr_mode = 'weight' WHERE id = v_uid;
  SELECT pr_mode INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 'weight' THEN
    RAISE EXCEPTION 'Failed to update pr_mode to weight';
  END IF;

  -- Invalid: 'e2rm'
  BEGIN
    UPDATE public.users SET pr_mode = 'e2rm' WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject pr_mode = e2rm';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: 'WEIGHT' (case sensitive)
  BEGIN
    UPDATE public.users SET pr_mode = 'WEIGHT' WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject pr_mode = WEIGHT';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: '' (empty string)
  BEGIN
    UPDATE public.users SET pr_mode = '' WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject pr_mode = empty string';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('CHECK constraint accepts weight and e1rm; rejects e2rm, uppercase, and empty string');

-- ============================================================================
-- 5. RLS Assertion: Authenticated User Updates Own pr_mode (1 row)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_rows int;
  v_mode text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'rls_own_pr@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_uid || '"}', true);

  UPDATE public.users SET pr_mode = 'e1rm' WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row updated for own profile, got %', v_rows;
  END IF;

  SELECT pr_mode INTO v_mode FROM public.users WHERE id = v_uid;
  IF v_mode <> 'e1rm' THEN
    RAISE EXCEPTION 'Expected pr_mode = e1rm after update, got %', v_mode;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Authenticated user can update own pr_mode (1 row updated)');

-- ============================================================================
-- 6. RLS Assertion: Authenticated User Cannot Update Other User (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_rows int;
  v_mode text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_a, 'user_a_prm@test.com', '{"role":"athlete"}'::jsonb),
         (v_user_b, 'user_b_prm@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_b || '"}', true);

  UPDATE public.users SET pr_mode = 'e1rm' WHERE id = v_user_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated when updating other user profile, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT pr_mode INTO v_mode FROM public.users WHERE id = v_user_a;
  IF v_mode <> 'weight' THEN
    RAISE EXCEPTION 'User A pr_mode was modified by User B: %', v_mode;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);
END;
$$;
SELECT pass('Authenticated user cannot update another user pr_mode (0 rows updated)');

-- ============================================================================
-- 7. RLS Assertion: Active Linked Coach Cannot Update Athlete pr_mode (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_rows int;
  v_mode text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'coach_prm_test@test.com', '{"role":"athlete"}'::jsonb),
         (v_ath_id, 'ath_prm_test@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-PRMOD', is_coach_mode = true, max_athletes = 3 WHERE id = v_coach_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-PRMOD');

  -- Coach attempts to update Athlete's pr_mode
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  UPDATE public.users SET pr_mode = 'e1rm' WHERE id = v_ath_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated when coach tries to update athlete pr_mode, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT pr_mode INTO v_mode FROM public.users WHERE id = v_ath_id;
  IF v_mode <> 'weight' THEN
    RAISE EXCEPTION 'Athlete pr_mode was modified by linked coach: %', v_mode;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('Active linked coach cannot update athlete pr_mode (0 rows updated)');

-- ============================================================================
-- 8. RLS Assertion: Anon Role Cannot Update User pr_mode (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_rows int;
  v_mode text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'anon_prm_user@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

  UPDATE public.users SET pr_mode = 'e1rm' WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated by anon, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT pr_mode INTO v_mode FROM public.users WHERE id = v_uid;
  IF v_mode <> 'weight' THEN
    RAISE EXCEPTION 'User pr_mode was modified by anon: %', v_mode;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Anon role cannot update user pr_mode (0 rows updated)');

-- ============================================================================
-- 9. Invariance Assertion: sets Checksum & sets.weight Unchanged
-- ============================================================================
DO $$
DECLARE
  v_chk_before text;
  v_chk_after text;
BEGIN
  SELECT md5(coalesce(string_agg(
    id::text || ':' || coalesce(weight::text,'') || ':' || coalesce(reps::text,'') || ':' || coalesce(set_type,''),
    ',' ORDER BY id
  ), '')) INTO v_chk_before
  FROM public.sets;

  ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS pr_mode text NOT NULL DEFAULT 'weight'
    CONSTRAINT users_pr_mode_check CHECK (pr_mode IN ('weight', 'e1rm'));

  SELECT md5(coalesce(string_agg(
    id::text || ':' || coalesce(weight::text,'') || ':' || coalesce(reps::text,'') || ':' || coalesce(set_type,''),
    ',' ORDER BY id
  ), '')) INTO v_chk_after
  FROM public.sets;

  IF v_chk_before <> v_chk_after THEN
    RAISE EXCEPTION 'Sets checksum changed across column addition: % vs %', v_chk_before, v_chk_after;
  END IF;
END;
$$;
SELECT pass('sets checksum and sets.weight values unchanged by column addition');

-- ============================================================================
-- 10. RPC Parameter Validation (invalid mode rejected)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_ex uuid := gen_random_uuid();
BEGIN
  -- Invalid mode in get_exercise_benchmarks
  BEGIN
    PERFORM * FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex], 'invalid_mode');
    RAISE EXCEPTION 'get_exercise_benchmarks failed to reject invalid mode';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid_pr_mode%' THEN
      RAISE EXCEPTION 'Expected invalid_pr_mode error, got: %', SQLERRM;
    END IF;
  END;

  -- Invalid mode in get_exercise_stats
  BEGIN
    PERFORM * FROM public.get_exercise_stats(v_uid, 'invalid_mode');
    RAISE EXCEPTION 'get_exercise_stats failed to reject invalid mode';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%invalid_pr_mode%' THEN
      RAISE EXCEPTION 'Expected invalid_pr_mode error, got: %', SQLERRM;
    END IF;
  END;
END;
$$;
SELECT pass('RPCs reject unknown p_pr_mode with coded error invalid_pr_mode');

-- ============================================================================
-- 11. RPC Default == Explicit 'weight' mode parity
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_ex uuid := gen_random_uuid();
  v_w uuid := gen_random_uuid();
  v_bm_def record;
  v_bm_exp record;
  v_st_def record;
  v_st_exp record;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'parity_prm@test.com');
  INSERT INTO public.exercises (id, user_id, name, is_master) VALUES (v_ex, v_uid, 'Parity Exercise', false);
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w, v_uid, 'Parity Workout', '2026-09-29 10:00:00+00', '2026-09-29');

  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES (v_w, v_ex, 100, 5, 1, 'working');

  -- Compare default call vs explicit 'weight' call for benchmarks
  SELECT * INTO v_bm_def FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex]);
  SELECT * INTO v_bm_exp FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex], 'weight');

  IF v_bm_def.pr_weight <> v_bm_exp.pr_weight OR v_bm_def.pr_reps <> v_bm_exp.pr_reps THEN
    RAISE EXCEPTION 'Benchmarks default <> explicit weight: %x% vs %x%',
      v_bm_def.pr_weight, v_bm_def.pr_reps, v_bm_exp.pr_weight, v_bm_exp.pr_reps;
  END IF;

  -- Compare default call vs explicit 'weight' call for stats
  SELECT * INTO v_st_def FROM public.get_exercise_stats(v_uid) WHERE exercise_id = v_ex;
  SELECT * INTO v_st_exp FROM public.get_exercise_stats(v_uid, 'weight') WHERE exercise_id = v_ex;

  IF v_st_def.max_weight <> v_st_exp.max_weight OR v_st_def.pr_reps <> v_st_exp.pr_reps THEN
    RAISE EXCEPTION 'Stats default <> explicit weight: %x% vs %x%',
      v_st_def.max_weight, v_st_def.pr_reps, v_st_exp.max_weight, v_st_exp.pr_reps;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Default p_pr_mode produces identical output to explicit weight mode');

-- ============================================================================
-- 12. e1rm Ranking Matrix: 100x3 vs 90x10, >12 reps excluded, bodyweight, equal e1rm, only-ineligible
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_ex1 uuid := gen_random_uuid();
  v_ex2 uuid := gen_random_uuid();
  v_ex3 uuid := gen_random_uuid();
  v_ex4 uuid := gen_random_uuid();
  v_ex5 uuid := gen_random_uuid();
  v_w uuid := gen_random_uuid();
  v_res record;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid, 'matrix_prm@test.com');
  INSERT INTO public.workouts (id, user_id, name, date, workout_date)
  VALUES (v_w, v_uid, 'Matrix Workout', '2026-09-29 10:00:00+00', '2026-09-29');

  -- Ex 1: 100x3 (e1rm 110) vs 90x10 (e1rm 120)
  INSERT INTO public.exercises (id, user_id, name, is_master) VALUES (v_ex1, v_uid, 'Matrix Ex 1', false);
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES
    (v_w, v_ex1, 100, 3, 1, 'working'),
    (v_w, v_ex1, 90, 10, 2, 'working');

  -- Ex 2: 100x15 (>12 reps, ineligible) vs 80x10 (eligible, e1rm 106.67)
  INSERT INTO public.exercises (id, user_id, name, is_master) VALUES (v_ex2, v_uid, 'Matrix Ex 2', false);
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES
    (v_w, v_ex2, 100, 15, 1, 'working'),
    (v_w, v_ex2, 80, 10, 2, 'working');

  -- Ex 3: Bodyweight 0x10 vs 0x20
  INSERT INTO public.exercises (id, user_id, name, is_master) VALUES (v_ex3, v_uid, 'Matrix Ex 3', false);
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES
    (v_w, v_ex3, 0, 10, 1, 'working'),
    (v_w, v_ex3, 0, 20, 2, 'working');

  -- Ex 4: Equal e1rm: 100x6 (e1rm 120) vs 90x10 (e1rm 120) -> heavier weight (100) wins
  INSERT INTO public.exercises (id, user_id, name, is_master) VALUES (v_ex4, v_uid, 'Matrix Ex 4', false);
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES
    (v_w, v_ex4, 90, 10, 1, 'working'),
    (v_w, v_ex4, 100, 6, 2, 'working');

  -- Ex 5: Only ineligible sets: 100x15 vs 90x20 (both >12 reps) -> weight ranking fallback (100x15 wins)
  INSERT INTO public.exercises (id, user_id, name, is_master) VALUES (v_ex5, v_uid, 'Matrix Ex 5', false);
  INSERT INTO public.sets (workout_id, exercise_id, weight, reps, set_index, set_type)
  VALUES
    (v_w, v_ex5, 90, 20, 1, 'working'),
    (v_w, v_ex5, 100, 15, 2, 'working');

  -- Check Ex 1 in weight mode: 100x3 wins
  SELECT * INTO v_res FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex1], 'weight');
  IF v_res.pr_weight <> 100 OR v_res.pr_reps <> 3 THEN
    RAISE EXCEPTION 'Ex 1 weight mode: expected 100x3, got %x%', v_res.pr_weight, v_res.pr_reps;
  END IF;

  -- Check Ex 1 in e1rm mode: 90x10 wins (e1rm 120.00)
  SELECT * INTO v_res FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex1], 'e1rm');
  IF v_res.pr_weight <> 90 OR v_res.pr_reps <> 10 OR v_res.pr_e1rm <> 120.00 THEN
    RAISE EXCEPTION 'Ex 1 e1rm mode: expected 90x10 (e1rm 120.00), got %x% (e1rm %)',
      v_res.pr_weight, v_res.pr_reps, v_res.pr_e1rm;
  END IF;

  -- Check Ex 2 in e1rm mode: >12 reps excluded, so 80x10 wins over 100x15
  SELECT * INTO v_res FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex2], 'e1rm');
  IF v_res.pr_weight <> 80 OR v_res.pr_reps <> 10 THEN
    RAISE EXCEPTION 'Ex 2 e1rm mode (>12 reps excluded): expected 80x10, got %x%', v_res.pr_weight, v_res.pr_reps;
  END IF;

  -- Check Ex 3 in e1rm mode: bodyweight reps decide, so 0x20 wins
  SELECT * INTO v_res FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex3], 'e1rm');
  IF v_res.pr_weight <> 0 OR v_res.pr_reps <> 20 OR v_res.pr_e1rm <> 0.00 THEN
    RAISE EXCEPTION 'Ex 3 e1rm mode (bodyweight): expected 0x20 (e1rm 0.00), got %x% (e1rm %)',
      v_res.pr_weight, v_res.pr_reps, v_res.pr_e1rm;
  END IF;

  -- Check Ex 4 in e1rm mode: equal e1rm (120), heavier weight (100x6) wins over 90x10
  SELECT * INTO v_res FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex4], 'e1rm');
  IF v_res.pr_weight <> 100 OR v_res.pr_reps <> 6 THEN
    RAISE EXCEPTION 'Ex 4 e1rm mode (equal e1rm): expected 100x6, got %x%', v_res.pr_weight, v_res.pr_reps;
  END IF;

  -- Check Ex 5 in e1rm mode: only ineligible sets falls back to weight ranking (100x15 wins over 90x20)
  SELECT * INTO v_res FROM public.get_exercise_benchmarks(v_uid, '2026-09-29'::date, ARRAY[v_ex5], 'e1rm');
  IF v_res.pr_weight <> 100 OR v_res.pr_reps <> 15 THEN
    RAISE EXCEPTION 'Ex 5 e1rm mode (only ineligible fallback): expected 100x15, got %x%', v_res.pr_weight, v_res.pr_reps;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('e1rm ranking matrix satisfies 100x3 vs 90x10, >12 reps exclusion, bodyweight reps, equal e1rm tie-break, and ineligible fallback');

SELECT * FROM finish();
ROLLBACK;
