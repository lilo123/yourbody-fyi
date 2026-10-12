BEGIN;
SELECT plan(9);

-- 1. Column existence
SELECT has_column('public', 'nutrition_logs', 'source', 'public.nutrition_logs has source column');
SELECT col_type_is('public', 'nutrition_logs', 'source', 'text', 'public.nutrition_logs.source is type text');
SELECT col_is_null('public', 'nutrition_logs', 'source', 'public.nutrition_logs.source is nullable');

SELECT has_column('public', 'nutrition_logs', 'parser_version', 'public.nutrition_logs has parser_version column');
SELECT col_type_is('public', 'nutrition_logs', 'parser_version', 'text', 'public.nutrition_logs.parser_version is type text');
SELECT col_is_null('public', 'nutrition_logs', 'parser_version', 'public.nutrition_logs.parser_version is nullable');

-- 2. Check constraint validation
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_log_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'src_test_user@test.com');

  -- Valid: 'device', 'ai', 'manual', NULL
  INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source, parser_version)
  VALUES (gen_random_uuid(), v_user_id, 'Device Meal', 200, now(), 'device', '2026.10');

  INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source, parser_version)
  VALUES (gen_random_uuid(), v_user_id, 'AI Meal', 300, now(), 'ai', '2026.10');

  INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source, parser_version)
  VALUES (gen_random_uuid(), v_user_id, 'Manual Meal', 400, now(), 'manual', NULL);

  INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source, parser_version)
  VALUES (gen_random_uuid(), v_user_id, 'Legacy Meal', 500, now(), NULL, NULL);

  -- Invalid source must fail
  BEGIN
    INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source)
    VALUES (gen_random_uuid(), v_user_id, 'Bad Meal', 100, now(), 'invalid_source');
    RAISE EXCEPTION 'CHECK constraint failed to reject invalid source';
  EXCEPTION WHEN check_violation THEN
    -- Expected check constraint violation
  END;

  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;
SELECT pass('chk_nutrition_logs_source accepts device/ai/manual/null and rejects invalid values');

-- 3. Owner insert and select under authenticated role with RLS
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_log_id uuid := gen_random_uuid();
  v_fetched_source text;
  v_fetched_version text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'owner_auth@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source, parser_version)
  VALUES (v_log_id, v_user_id, 'Protein Bowl', 550, now(), 'device', '2026.10');

  SELECT source, parser_version INTO v_fetched_source, v_fetched_version
  FROM public.nutrition_logs
  WHERE id = v_log_id;

  IF v_fetched_source <> 'device' OR v_fetched_version <> '2026.10' THEN
    RAISE EXCEPTION 'Owner select mismatch: expected device/2026.10, got %/%', v_fetched_source, v_fetched_version;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM auth.users WHERE id = v_user_id;
END;
$$;
SELECT pass('Authenticated owner can insert and select nutrition_logs with source and parser_version');

-- 4. Cross-user isolation under RLS
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_log_id uuid := gen_random_uuid();
  v_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_a, 'user_a@test.com'), (v_user_b, 'user_b@test.com');

  -- User A logs a meal
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);

  INSERT INTO public.nutrition_logs (id, user_id, food_name, calories, logged_at, source, parser_version)
  VALUES (v_log_id, v_user_a, 'Private Meal', 250, now(), 'ai', '2026.10');

  -- User B tries to select user A row
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_b || '"}', true);

  SELECT count(*) INTO v_count FROM public.nutrition_logs WHERE id = v_log_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Cross-user leak: User B was able to see User A nutrition log';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM auth.users WHERE id IN (v_user_a, v_user_b);
END;
$$;
SELECT pass('Cross-user isolation enforced for nutrition_logs with source and parser_version');

-- 5. Complete
SELECT finish();
ROLLBACK;
