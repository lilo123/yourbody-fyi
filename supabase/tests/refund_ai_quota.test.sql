BEGIN;
SELECT plan(6);

-- 1. Function existence
SELECT has_function('public', 'refund_ai_quota', ARRAY['uuid', 'integer'], 'public.refund_ai_quota(uuid, integer) exists');

-- 2. Decrement works under service_role
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_new_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'refund_test_1@test.com');
  INSERT INTO public.ai_usage (user_id, period_kind, period_start, count)
  VALUES (v_user_id, 'day', v_today, 5);

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_new_count := public.refund_ai_quota(v_user_id, 2);
  IF v_new_count <> 3 THEN
    RAISE EXCEPTION 'Expected count 3 after refunding 2 from 5, got %', v_new_count;
  END IF;

  SELECT count INTO v_new_count FROM public.ai_usage
  WHERE user_id = v_user_id AND period_kind = 'day' AND period_start = v_today;
  IF v_new_count <> 3 THEN
    RAISE EXCEPTION 'Table count mismatch: expected 3, got %', v_new_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('refund_ai_quota decrements current period row under service_role');

-- 3. Never below 0
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_new_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'refund_test_2@test.com');
  INSERT INTO public.ai_usage (user_id, period_kind, period_start, count)
  VALUES (v_user_id, 'day', v_today, 3);

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_new_count := public.refund_ai_quota(v_user_id, 10);
  IF v_new_count <> 0 THEN
    RAISE EXCEPTION 'Expected count 0 after refunding 10 from 3, got %', v_new_count;
  END IF;

  SELECT count INTO v_new_count FROM public.ai_usage
  WHERE user_id = v_user_id AND period_kind = 'day' AND period_start = v_today;
  IF v_new_count <> 0 THEN
    RAISE EXCEPTION 'Table count mismatch: expected 0, got %', v_new_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('refund_ai_quota never decrements below 0');

-- 4. Authenticated role cannot execute (insufficient_privilege)
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'refund_test_3@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  BEGIN
    PERFORM public.refund_ai_quota(v_user_id, 1);
    RAISE EXCEPTION 'Authenticated role was able to execute refund_ai_quota';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: permission denied
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated cannot execute refund_ai_quota');

-- 5. Anon role cannot execute (insufficient_privilege)
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'refund_test_4@test.com');

  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    PERFORM public.refund_ai_quota(v_user_id, 1);
    RAISE EXCEPTION 'Anon role was able to execute refund_ai_quota';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: permission denied
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('anon cannot execute refund_ai_quota');

-- 6. Non-existent row returns 0
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_id, 'refund_test_5@test.com');

  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_count := public.refund_ai_quota(v_user_id, 1);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected count 0 for user with no ai_usage row, got %', v_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('refund_ai_quota on user with no usage row returns 0');

SELECT * FROM finish();
ROLLBACK;
