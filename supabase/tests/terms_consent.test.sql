BEGIN;
SELECT plan(11);

-- 1. Columns exist and are nullable
SELECT has_column('public', 'users', 'terms_version', 'public.users has terms_version column');
SELECT col_is_null('public', 'users', 'terms_version', 'terms_version is nullable');
SELECT col_type_is('public', 'users', 'terms_version', 'text', 'terms_version is text');

SELECT has_column('public', 'users', 'terms_accepted_at', 'public.users has terms_accepted_at column');
SELECT col_is_null('public', 'users', 'terms_accepted_at', 'terms_accepted_at is nullable');
SELECT col_type_is('public', 'users', 'terms_accepted_at', 'timestamp with time zone', 'terms_accepted_at is timestamptz');

-- 2. Authenticated user cannot UPDATE their own terms_version or terms_accepted_at directly
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'consent_user1@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  -- Attempt direct terms_version update
  BEGIN
    UPDATE public.users SET terms_version = '2026-10-10' WHERE id = v_user_id;
    RAISE EXCEPTION 'Direct update of terms_version was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unauthorized: consent fields can only be set through accept_terms%' THEN
      RAISE EXCEPTION 'Unexpected error on terms_version update: %', SQLERRM;
    END IF;
  END;

  -- Attempt direct terms_accepted_at update
  BEGIN
    UPDATE public.users SET terms_accepted_at = now() WHERE id = v_user_id;
    RAISE EXCEPTION 'Direct update of terms_accepted_at was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unauthorized: consent fields can only be set through accept_terms%' THEN
      RAISE EXCEPTION 'Unexpected error on terms_accepted_at update: %', SQLERRM;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Authenticated user cannot UPDATE terms_version or terms_accepted_at directly');

-- 3. Authenticated user can still UPDATE other own columns
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_cal numeric;
  v_tz text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'consent_user2@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  UPDATE public.users
  SET target_calories = 2300, timezone = 'America/Chicago'
  WHERE id = v_user_id;

  SELECT target_calories, timezone INTO v_cal, v_tz
  FROM public.users WHERE id = v_user_id;

  IF v_cal <> 2300 OR v_tz <> 'America/Chicago' THEN
    RAISE EXCEPTION 'Failed to update target_calories or timezone: cal=%, tz=%', v_cal, v_tz;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Authenticated user can still UPDATE other own columns (timezone, target_calories)');

-- 4. accept_terms sets both columns for calling user only
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_res jsonb;
  v_ver_a text;
  v_ts_a timestamptz;
  v_ver_b text;
  v_ts_b timestamptz;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_a, 'consent_user_a@test.com'), (v_user_b, 'consent_user_b@test.com');

  -- User A accepts terms
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);

  v_res := public.accept_terms('2026-10-10');

  IF (v_res->>'terms_version') <> '2026-10-10' OR (v_res->>'terms_accepted_at') IS NULL THEN
    RAISE EXCEPTION 'accept_terms returned invalid payload: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- Check User A row
  SELECT terms_version, terms_accepted_at INTO v_ver_a, v_ts_a
  FROM public.users WHERE id = v_user_a;

  IF v_ver_a <> '2026-10-10' OR v_ts_a IS NULL THEN
    RAISE EXCEPTION 'User A row not updated correctly: ver=%, ts=%', v_ver_a, v_ts_a;
  END IF;

  -- Check User B row (must remain untouched)
  SELECT terms_version, terms_accepted_at INTO v_ver_b, v_ts_b
  FROM public.users WHERE id = v_user_b;

  IF v_ver_b IS NOT NULL OR v_ts_b IS NOT NULL THEN
    RAISE EXCEPTION 'User B row was modified: ver=%, ts=%', v_ver_b, v_ts_b;
  END IF;
END;
$$;
SELECT pass('accept_terms sets both columns for calling user only, leaving others untouched');

-- 5. Unauthenticated call raises; bad version string raises
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'bad_ver@test.com');

  -- 5a. Anon execute revoked
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    PERFORM public.accept_terms('2026-10-10');
    RAISE EXCEPTION 'Anon call to accept_terms was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: permission denied for anon
  END;

  -- 5b. Authenticated without uid raises 28000
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);

  BEGIN
    PERFORM public.accept_terms('2026-10-10');
    RAISE EXCEPTION 'Authenticated call without uid was accepted';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    -- Expected: 28000
  END;

  -- 5c. Bad version string raises 22023
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  BEGIN
    PERFORM public.accept_terms('invalid-version');
    RAISE EXCEPTION 'Invalid version accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: 22023
  END;

  BEGIN
    PERFORM public.accept_terms('2026-1-1');
    RAISE EXCEPTION 'Invalid version format accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected: 22023
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Unauthenticated call and bad version string raise expected errors (28000, 22023, insufficient_privilege)');

-- 6. Service role can update the columns directly
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_ver text;
  v_ts timestamptz;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'service_role_user@test.com');

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  UPDATE public.users
  SET terms_version = '2026-10-10',
      terms_accepted_at = '2026-10-10 12:00:00+00'::timestamptz
  WHERE id = v_user_id;

  SELECT terms_version, terms_accepted_at INTO v_ver, v_ts
  FROM public.users WHERE id = v_user_id;

  IF v_ver <> '2026-10-10' OR v_ts <> '2026-10-10 12:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'service_role update failed: ver=%, ts=%', v_ver, v_ts;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Service role can update terms_version and terms_accepted_at directly');

SELECT * FROM finish();
ROLLBACK;
