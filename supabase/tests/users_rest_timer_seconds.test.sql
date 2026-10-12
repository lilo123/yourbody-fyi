BEGIN;
SELECT plan(9);

-- ============================================================================
-- 1. Column Existence, Type, NOT NULL, and Default Assertions
-- ============================================================================
SELECT has_column('public', 'users', 'rest_timer_seconds', 'users table has rest_timer_seconds column');
SELECT col_type_is('public', 'users', 'rest_timer_seconds', 'integer', 'users.rest_timer_seconds is type integer');
SELECT col_not_null('public', 'users', 'rest_timer_seconds', 'users.rest_timer_seconds is NOT NULL');
SELECT col_default_is('public', 'users', 'rest_timer_seconds', '90', 'users.rest_timer_seconds default is 90');

-- ============================================================================
-- 2. Existing Rows Assertion
-- ============================================================================
SELECT is_empty(
  'SELECT id FROM public.users WHERE rest_timer_seconds IS NULL OR rest_timer_seconds < 15 OR rest_timer_seconds > 600',
  'All existing users rows have a valid rest_timer_seconds (15..600)'
);

-- ============================================================================
-- 3. New User Defaults Assertion (auth signup trigger & direct insert)
-- ============================================================================
DO $$
DECLARE
  v_uid_auth uuid := gen_random_uuid();
  v_uid_direct uuid := gen_random_uuid();
  v_secs int;
BEGIN
  -- Insert via auth.users (trigger handle_new_user populates public.users)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid_auth, 'new_timer_auth_user@test.com', '{"role":"athlete"}'::jsonb);

  SELECT rest_timer_seconds INTO v_secs FROM public.users WHERE id = v_uid_auth;
  IF v_secs <> 90 THEN
    RAISE EXCEPTION 'Expected rest_timer_seconds = 90 via auth signup trigger, got %', v_secs;
  END IF;

  -- Insert directly into public.users without specifying rest_timer_seconds
  INSERT INTO auth.users (id, email) VALUES (v_uid_direct, 'new_timer_direct_user@test.com');
  DELETE FROM public.users WHERE id = v_uid_direct;
  INSERT INTO public.users (id, email) VALUES (v_uid_direct, 'new_timer_direct_user@test.com');

  SELECT rest_timer_seconds INTO v_secs FROM public.users WHERE id = v_uid_direct;
  IF v_secs <> 90 THEN
    RAISE EXCEPTION 'Expected rest_timer_seconds = 90 via direct table insert, got %', v_secs;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_uid_auth, v_uid_direct);
END;
$$;
SELECT pass('New user rows default rest_timer_seconds to 90 (auth signup trigger and direct insert)');

-- ============================================================================
-- 4. CHECK Constraint Assertion (accepts 30 and 300; rejects 10 and 601)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_val int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'chk_timer_user@test.com', '{"role":"athlete"}'::jsonb);

  -- Valid: 30
  UPDATE public.users SET rest_timer_seconds = 30 WHERE id = v_uid;
  SELECT rest_timer_seconds INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 30 THEN
    RAISE EXCEPTION 'Failed to update rest_timer_seconds to 30';
  END IF;

  -- Valid: 300
  UPDATE public.users SET rest_timer_seconds = 300 WHERE id = v_uid;
  SELECT rest_timer_seconds INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 300 THEN
    RAISE EXCEPTION 'Failed to update rest_timer_seconds to 300';
  END IF;

  -- Invalid: 10
  BEGIN
    UPDATE public.users SET rest_timer_seconds = 10 WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject rest_timer_seconds = 10';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: 601
  BEGIN
    UPDATE public.users SET rest_timer_seconds = 601 WHERE id = v_uid;
    RAISE EXCEPTION 'CHECK constraint failed to reject rest_timer_seconds = 601';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('CHECK constraint accepts 30 and 300; rejects 10 and 601');

-- ============================================================================
-- 5. RLS Assertion: Authenticated User Updates Own rest_timer_seconds (1 row)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_rows int;
  v_val int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'rls_timer_own@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_uid || '"}', true);

  UPDATE public.users SET rest_timer_seconds = 120 WHERE id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Expected 1 row updated for own profile, got %', v_rows;
  END IF;

  SELECT rest_timer_seconds INTO v_val FROM public.users WHERE id = v_uid;
  IF v_val <> 120 THEN
    RAISE EXCEPTION 'Expected rest_timer_seconds = 120 after update, got %', v_val;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('Authenticated user can update own rest_timer_seconds (1 row updated)');

-- ============================================================================
-- 6. RLS Assertion: Authenticated User Cannot Update Other User (0 rows)
-- ============================================================================
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_rows int;
  v_val int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_a, 'user_a_timer_rls@test.com', '{"role":"athlete"}'::jsonb),
         (v_user_b, 'user_b_timer_rls@test.com', '{"role":"athlete"}'::jsonb);

  -- User B attempts to update User A's rest_timer_seconds
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_b || '"}', true);

  UPDATE public.users SET rest_timer_seconds = 180 WHERE id = v_user_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Expected 0 rows updated when updating other user profile, got %', v_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Verify User A's value was NOT changed
  SELECT rest_timer_seconds INTO v_val FROM public.users WHERE id = v_user_a;
  IF v_val <> 90 THEN
    RAISE EXCEPTION 'User A rest_timer_seconds was modified by User B: %', v_val;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);
END;
$$;
SELECT pass('Authenticated user cannot update another user rest_timer_seconds (0 rows updated)');

SELECT * FROM finish();
ROLLBACK;
