BEGIN;
SELECT plan(8);

-- 1. Table existence
SELECT has_table('public', 'app_config', 'public.app_config table exists');

-- 2. RLS enabled
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_config'::regclass),
  'RLS is enabled on public.app_config'
);

-- 3. CHECK constraint rejects invalid keys
DO $$
BEGIN
  -- Test 1: Uppercase character
  BEGIN
    INSERT INTO public.app_config (key, value) VALUES ('Invalid_Key', 'true'::jsonb);
    RAISE EXCEPTION 'Uppercase key was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Test 2: Leading hyphen
  BEGIN
    INSERT INTO public.app_config (key, value) VALUES ('-invalid', 'true'::jsonb);
    RAISE EXCEPTION 'Leading hyphen key was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Test 3: Leading period
  BEGIN
    INSERT INTO public.app_config (key, value) VALUES ('.invalid', 'true'::jsonb);
    RAISE EXCEPTION 'Leading period key was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Test 4: Empty string
  BEGIN
    INSERT INTO public.app_config (key, value) VALUES ('', 'true'::jsonb);
    RAISE EXCEPTION 'Empty string key was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

END;
$$;
SELECT pass('CHECK constraint app_config_key_check rejects invalid keys (uppercase, leading symbol, empty)');

-- 4. service_role can insert and update
DO $$
DECLARE
  v_inserted_val jsonb;
  v_updated_val jsonb;
BEGIN
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO public.app_config (key, value, description)
  VALUES ('feature_dark_launch', 'true'::jsonb, 'Dark launch flag for upcoming features');

  SELECT value INTO v_inserted_val FROM public.app_config WHERE key = 'feature_dark_launch';
  IF v_inserted_val <> 'true'::jsonb THEN
    RAISE EXCEPTION 'service_role insert failed or value mismatch: %', v_inserted_val;
  END IF;

  UPDATE public.app_config
  SET value = 'false'::jsonb
  WHERE key = 'feature_dark_launch';

  SELECT value INTO v_updated_val FROM public.app_config WHERE key = 'feature_dark_launch';
  IF v_updated_val <> 'false'::jsonb THEN
    RAISE EXCEPTION 'service_role update failed or value mismatch: %', v_updated_val;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('service_role can insert and update app_config rows');

-- 5. authenticated can SELECT seeded rows
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_seen_count integer;
  v_flag_val jsonb;
BEGIN
  -- Authenticate as a normal user
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  SELECT count(*), value INTO v_seen_count, v_flag_val
  FROM public.app_config
  WHERE key = 'feature_dark_launch'
  GROUP BY value;

  IF v_seen_count <> 1 OR v_flag_val <> 'false'::jsonb THEN
    RAISE EXCEPTION 'authenticated role failed to select seeded row: count=%, value=%', v_seen_count, v_flag_val;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated role can SELECT seeded app_config rows');

-- 6. authenticated INSERT/UPDATE/DELETE are denied (permission denied error 42501 due to lack of table grants)
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_insert_denied boolean := false;
  v_update_denied boolean := false;
  v_delete_denied boolean := false;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  -- Authenticated INSERT attempt
  BEGIN
    INSERT INTO public.app_config (key, value) VALUES ('unauthorized_key', 'true'::jsonb);
    RAISE EXCEPTION 'authenticated INSERT was allowed unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Observed behavior: REVOKE ALL except SELECT raises 42501 insufficient_privilege
    v_insert_denied := true;
  END;

  -- Authenticated UPDATE attempt
  BEGIN
    UPDATE public.app_config SET value = 'true'::jsonb WHERE key = 'feature_dark_launch';
    RAISE EXCEPTION 'authenticated UPDATE was allowed unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Observed behavior: lack of UPDATE grant raises 42501 insufficient_privilege
    v_update_denied := true;
  END;

  -- Authenticated DELETE attempt
  BEGIN
    DELETE FROM public.app_config WHERE key = 'feature_dark_launch';
    RAISE EXCEPTION 'authenticated DELETE was allowed unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Observed behavior: lack of DELETE grant raises 42501 insufficient_privilege
    v_delete_denied := true;
  END;

  IF NOT (v_insert_denied AND v_update_denied AND v_delete_denied) THEN
    RAISE EXCEPTION 'Not all authenticated mutation attempts were denied';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated INSERT, UPDATE, and DELETE are denied with insufficient_privilege (42501) due to revoked table grants');

-- 7. anon SELECT is denied
DO $$
DECLARE
  v_anon_denied boolean := false;
BEGIN
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);

  BEGIN
    PERFORM * FROM public.app_config;
    RAISE EXCEPTION 'anon SELECT was allowed unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Observed behavior: lack of SELECT grant for anon raises 42501 insufficient_privilege
    v_anon_denied := true;
  END;

  IF NOT v_anon_denied THEN
    RAISE EXCEPTION 'anon SELECT was not denied';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('anon SELECT is denied with insufficient_privilege (42501) due to revoked table grants');

-- 8. Valid slug patterns are accepted by CHECK constraint
DO $$
BEGIN
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO public.app_config (key, value) VALUES
    ('flag-alpha', 'true'::jsonb),
    ('v2.beta.feature', 'false'::jsonb),
    ('0123-numbers-allowed', '{"count": 1}'::jsonb);

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('CHECK constraint accepts valid slug keys (hyphens, dots, underscores, numbers)');

SELECT * FROM finish();
ROLLBACK;
