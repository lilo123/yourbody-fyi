BEGIN;
SELECT plan(12);

-- ============================================================================
-- 1. Column Existence, Type, NOT NULL, and Default Assertions
-- ============================================================================
SELECT has_column('public', 'users', 'weight_unit', 'users table has weight_unit column');
SELECT col_type_is('public', 'users', 'weight_unit', 'text', 'users.weight_unit is type text');
SELECT col_not_null('public', 'users', 'weight_unit', 'users.weight_unit is NOT NULL');
SELECT col_default_is('public', 'users', 'weight_unit', 'lb', 'users.weight_unit default is lb');

-- ============================================================================
-- 2. Existing Rows Assertion
-- ============================================================================
SELECT is_empty(
  'SELECT id FROM public.users WHERE weight_unit IS NULL OR weight_unit NOT IN (''lb'', ''kg'')',
  'All existing users rows have a valid weight_unit (backfill to lb is proven by the M6 post audit)'
);

-- ============================================================================
-- 3. New User Defaults Assertion (auth signup trigger & direct insert)
-- ============================================================================
DO $$
DECLARE
  v_uid_auth uuid := gen_random_uuid();
  v_uid_direct uuid := gen_random_uuid();
  v_unit text;
BEGIN
  -- Insert via auth.users (trigger handle_new_user populates public.users)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid_auth, 'new_auth_user@test.com', '{"role":"athlete"}'::jsonb);

  SELECT weight_unit INTO v_unit FROM public.users WHERE id = v_uid_auth;
  IF v_unit <> 'lb' THEN
    RAISE EXCEPTION 'Expected weight_unit = lb via auth signup trigger, got %', v_unit;
  END IF;

  -- Insert directly into public.users without specifying weight_unit
  INSERT INTO auth.users (id, email) VALUES (v_uid_direct, 'new_direct_user@test.com');
  DELETE FROM public.users WHERE id = v_uid_direct;
  INSERT INTO public.users (id, email) VALUES (v_uid_direct, 'new_direct_user@test.com');

  SELECT weight_unit INTO v_unit FROM public.users WHERE id = v_uid_direct;
  IF v_unit <> 'lb' THEN
    RAISE EXCEPTION 'Expected weight_unit = lb via direct table insert, got %', v_unit;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_uid_auth, v_uid_direct);
END;
$$;
SELECT pass('New user rows default weight_unit to lb (auth signup trigger and direct insert)');

-- ============================================================================
-- 4. CHECK Constraint Assertion (accepts 'lb', 'kg'; rejects 'stone', 'lbs', '')
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_val text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'chk_user@test.com', '{"role":"athlete"}'::jsonb);

  -- Valid: 'kg'
  UPDATE public.users SET weight_unit = 'kg' WHERE id = v_uid;
  SELECT weight_unit INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 'kg' THEN
    RAISE EXCEPTION 'Failed to update weight_unit to kg';
  END IF;

  -- Valid: 'lb'
  UPDATE public.users SET weight_unit = 'lb' WHERE id = v_uid;
  SELECT weight_unit INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 'lb' THEN
    RAISE EXCEPTION 'Failed to update weight_unit to lb';
  END IF;

  -- Invalid: 'stone'
  BEGIN
    UPDATE public.users SET weight_unit = 'stone' WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject weight_unit = stone';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: 'lbs'
  BEGIN
    UPDATE public.users SET weight_unit = 'lbs' WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject weight_unit = lbs';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: '' (empty string)
  BEGIN
    UPDATE public.users SET weight_unit = '' WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject weight_unit = empty string';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('CHECK constraint accepts lb and kg; rejects stone, lbs, and empty string');

-- ============================================================================
-- 5. RLS Assertion: Authenticated User Updates Own weight_unit (1 row)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_rows int;
  v_unit text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'rls_own@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_uid || '"}', true);

  UPDATE public.users SET weight_unit = 'kg' WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row updated for own profile, got %', v_rows;
  END IF;

  SELECT weight_unit INTO v_unit FROM public.users WHERE id = v_uid;
  IF v_unit <> 'kg' THEN
    RAISE EXCEPTION 'Expected weight_unit = kg after update, got %', v_unit;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Authenticated user can update own weight_unit (1 row updated)');

-- ============================================================================
-- 6. RLS Assertion: Authenticated User Cannot Update Other User (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_rows int;
  v_unit text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_a, 'user_a_rls@test.com', '{"role":"athlete"}'::jsonb),
         (v_user_b, 'user_b_rls@test.com', '{"role":"athlete"}'::jsonb);

  -- User B attempts to update User A's weight_unit
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_b || '"}', true);

  UPDATE public.users SET weight_unit = 'kg' WHERE id = v_user_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated when updating other user profile, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Verify User A's unit was NOT changed
  SELECT weight_unit INTO v_unit FROM public.users WHERE id = v_user_a;
  IF v_unit <> 'lb' THEN
    RAISE EXCEPTION 'User A weight_unit was modified by User B: %', v_unit;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);
END;
$$;
SELECT pass('Authenticated user cannot update another user weight_unit (0 rows updated)');

-- ============================================================================
-- 7. RLS Assertion: Active Linked Coach Cannot Update Athlete Unit (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_rows int;
  v_unit text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'coach_rls_test@test.com', '{"role":"athlete"}'::jsonb),
         (v_ath_id, 'ath_rls_test@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-WUNIT', is_coach_mode = true, max_athletes = 3 WHERE id = v_coach_id;

  -- Athlete links to coach
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-WUNIT');

  -- Verify active link exists
  IF NOT EXISTS (SELECT 1 FROM public.coach_athlete_links WHERE coach_id = v_coach_id AND athlete_id = v_ath_id AND status = 'active') THEN
    RAISE EXCEPTION 'Coach athlete link was not created';
  END IF;

  -- Coach attempts to update Athlete's weight_unit
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  UPDATE public.users SET weight_unit = 'kg' WHERE id = v_ath_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated when coach tries to update athlete weight_unit, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Verify Athlete's weight_unit is untouched
  SELECT weight_unit INTO v_unit FROM public.users WHERE id = v_ath_id;
  IF v_unit <> 'lb' THEN
    RAISE EXCEPTION 'Athlete weight_unit was modified by linked coach: %', v_unit;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('Active linked coach cannot update athlete weight_unit (0 rows updated)');

-- ============================================================================
-- 8. RLS Assertion: Anon Role Cannot Update User weight_unit (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_rows int;
  v_unit text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'anon_test_user@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

  UPDATE public.users SET weight_unit = 'kg' WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated by anon, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT weight_unit INTO v_unit FROM public.users WHERE id = v_uid;
  IF v_unit <> 'lb' THEN
    RAISE EXCEPTION 'User weight_unit was modified by anon: %', v_unit;
  END IF;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Anon role cannot update user weight_unit (0 rows updated)');

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

  -- Re-execute idempotent column addition statement inside test transaction
  ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'lb'
    CONSTRAINT users_weight_unit_check CHECK (weight_unit IN ('lb', 'kg'));

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

SELECT * FROM finish();
ROLLBACK;
