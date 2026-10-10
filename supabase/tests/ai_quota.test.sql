BEGIN;
SELECT plan(16);

-- 1. Table existence
SELECT has_table('public', 'ai_usage', 'public.ai_usage table exists');

-- 2. RLS enabled
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_usage'::regclass),
  'RLS is enabled on public.ai_usage'
);

-- 3. Authenticated direct INSERT is blocked (insufficient_privilege)
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  BEGIN
    INSERT INTO public.ai_usage (user_id, period_kind, period_start, count)
    VALUES (v_user_id, 'day', (now() AT TIME ZONE 'UTC')::date, 1);
    RAISE EXCEPTION 'Direct INSERT by authenticated user was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: direct INSERT is revoked
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated cannot direct INSERT into ai_usage');

-- 4. Authenticated direct UPDATE is blocked
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  BEGIN
    UPDATE public.ai_usage
    SET count = 5
    WHERE user_id = v_user_id;
    RAISE EXCEPTION 'Direct UPDATE by authenticated user was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: direct UPDATE is revoked
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated cannot direct UPDATE ai_usage');

-- 5. Authenticated direct DELETE is blocked
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_id || '"}', true);

  BEGIN
    DELETE FROM public.ai_usage WHERE user_id = v_user_id;
    RAISE EXCEPTION 'Direct DELETE by authenticated user was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: direct DELETE is revoked
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated cannot direct DELETE from ai_usage');

-- 6. Authenticated SELECT sees only own rows
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_seen_count integer;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Insert auth users and ai_usage records as postgres/service
  INSERT INTO auth.users (id, email) VALUES (v_user_a, 'user_a@test.com'), (v_user_b, 'user_b@test.com');
  INSERT INTO public.ai_usage (user_id, period_kind, period_start, count)
  VALUES (v_user_a, 'day', v_today, 5), (v_user_b, 'day', v_today, 10);

  -- Impersonate user A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);

  SELECT count(*) INTO v_seen_count FROM public.ai_usage;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'User A sees % rows instead of 1', v_seen_count;
  END IF;

  SELECT count INTO v_seen_count FROM public.ai_usage WHERE user_id = v_user_a;
  IF v_seen_count <> 5 THEN
    RAISE EXCEPTION 'User A row count mismatch: %', v_seen_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated SELECT sees only own rows via RLS policy');

-- 7. Trial user: 30 consumes of cost 1 allowed; 31st denied with allowed=false, used=30, limit=30
DO $$
DECLARE
  v_user_c uuid := gen_random_uuid();
  v_res jsonb;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_c, 'user_c_trial@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_c || '"}', true);

  FOR i IN 1..30 LOOP
    v_res := public.consume_ai_quota(1);
    IF (v_res->>'allowed')::boolean <> true OR (v_res->>'used')::integer <> i THEN
      RAISE EXCEPTION 'Consume #% failed: %', i, v_res;
    END IF;
  END LOOP;

  -- 31st consume must be denied
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> false
     OR (v_res->>'used')::integer <> 30
     OR (v_res->>'limit')::integer <> 30
     OR v_res->>'plan' <> 'trial' THEN
    RAISE EXCEPTION '31st consume not properly denied: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Trial user: 30 consumes allowed, 31st denied with allowed=false, used=30, limit=30');

-- 8. Photo cost 2: 15 allowed on fresh trial user, 16th denied
DO $$
DECLARE
  v_user_d uuid := gen_random_uuid();
  v_res jsonb;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_d, 'user_d_photo@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_d || '"}', true);

  FOR i IN 1..15 LOOP
    v_res := public.consume_ai_quota(2);
    IF (v_res->>'allowed')::boolean <> true OR (v_res->>'used')::integer <> (i * 2) THEN
      RAISE EXCEPTION 'Photo consume #% failed: %', i, v_res;
    END IF;
  END LOOP;

  -- 16th photo consume must be denied
  v_res := public.consume_ai_quota(2);
  IF (v_res->>'allowed')::boolean <> false OR (v_res->>'used')::integer <> 30 THEN
    RAISE EXCEPTION '16th photo consume not properly denied: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Photo cost 2: 15 photo consumes allowed on fresh trial user, 16th denied');

-- 9. Mixed 29 + photo(2) is denied without changing the count
DO $$
DECLARE
  v_user_e uuid := gen_random_uuid();
  v_res jsonb;
  v_count integer;
  i integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_e, 'user_e_mixed@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_e || '"}', true);

  FOR i IN 1..29 LOOP
    v_res := public.consume_ai_quota(1);
    IF (v_res->>'allowed')::boolean <> true THEN
      RAISE EXCEPTION 'Consume #% failed: %', i, v_res;
    END IF;
  END LOOP;

  -- Photo consume of cost 2 when 29/30 used
  v_res := public.consume_ai_quota(2);
  IF (v_res->>'allowed')::boolean <> false OR (v_res->>'used')::integer <> 29 THEN
    RAISE EXCEPTION 'Photo consume at 29 used not properly denied: %', v_res;
  END IF;

  -- Verify count in table did not change
  SELECT count INTO v_count
  FROM public.ai_usage
  WHERE user_id = v_user_e AND period_kind = 'day' AND period_start = (now() AT TIME ZONE 'UTC')::date;

  IF v_count <> 29 THEN
    RAISE EXCEPTION 'Count in ai_usage changed after denied photo consume: %', v_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Mixed 29 + photo(2) is denied without changing the count');

-- 10. Free user: created 20 days ago, trial_ends_at null -> first consume denied, no ai_usage row created
DO $$
DECLARE
  v_user_f uuid := gen_random_uuid();
  v_res jsonb;
  v_row_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_f, 'user_f_free@test.com');
  UPDATE public.users SET created_at = now() - interval '20 days', trial_ends_at = NULL WHERE id = v_user_f;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_f || '"}', true);

  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> false
     OR (v_res->>'used')::integer <> 0
     OR (v_res->>'limit')::integer <> 0
     OR v_res->>'plan' <> 'free' THEN
    RAISE EXCEPTION 'Free user consume response unexpected: %', v_res;
  END IF;

  SELECT count(*) INTO v_row_count FROM public.ai_usage WHERE user_id = v_user_f;
  IF v_row_count <> 0 THEN
    RAISE EXCEPTION 'ai_usage row was created for free user: %', v_row_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Free user: first consume is denied with no ai_usage row created');

-- 11. Explicit trial_ends_at in future on old account -> trial applies
DO $$
DECLARE
  v_user_g uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_g, 'user_g_extended@test.com');
  UPDATE public.users
  SET created_at = now() - interval '20 days', trial_ends_at = now() + interval '5 days'
  WHERE id = v_user_g;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_g || '"}', true);

  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> true
     OR v_res->>'plan' <> 'trial'
     OR (v_res->>'used')::integer <> 1 THEN
    RAISE EXCEPTION 'Explicit future trial_ends_at failed to apply trial: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Explicit trial_ends_at in future on old account applies trial');

-- 12. Limits come from app_config: update ai_quota_limits to trial limit 2 -> 3rd consume denied
DO $$
DECLARE
  v_user_h uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  -- Update config as postgres
  UPDATE public.app_config
  SET value = jsonb_set(value, '{plans,trial,limit}', '2')
  WHERE key = 'ai_quota_limits';

  INSERT INTO auth.users (id, email) VALUES (v_user_h, 'user_h_cfg@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_h || '"}', true);

  -- 1st consume: allowed
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> true OR (v_res->>'used')::integer <> 1 THEN
    RAISE EXCEPTION 'Consume 1 failed under config limit 2: %', v_res;
  END IF;

  -- 2nd consume: allowed
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> true OR (v_res->>'used')::integer <> 2 THEN
    RAISE EXCEPTION 'Consume 2 failed under config limit 2: %', v_res;
  END IF;

  -- 3rd consume: denied
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> false
     OR (v_res->>'used')::integer <> 2
     OR (v_res->>'limit')::integer <> 2 THEN
    RAISE EXCEPTION 'Consume 3 not denied under config limit 2: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Limits come from app_config: updating trial limit to 2 denies 3rd consume');

-- 13. Unauthenticated call raises exception (anon denied execute, authenticated without uid raises 28000)
DO $$
BEGIN
  -- Anon has execute revoked
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  BEGIN
    PERFORM public.consume_ai_quota(1);
    RAISE EXCEPTION 'Anon call was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: permission denied for anon
  END;

  -- Authenticated role without sub/uid raises 28000 in function body
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);

  BEGIN
    PERFORM public.consume_ai_quota(1);
    RAISE EXCEPTION 'Authenticated call without uid was accepted';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    -- Expected: Authentication required errcode 28000
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Unauthenticated call raises (anon denied execute, authenticated without uid raises 28000)');

-- 14. Cost 0 or 11 raises exception 22023
DO $$
DECLARE
  v_user_test uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_test, 'cost_test@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_test || '"}', true);

  BEGIN
    PERFORM public.consume_ai_quota(0);
    RAISE EXCEPTION 'Cost 0 was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected
  END;

  BEGIN
    PERFORM public.consume_ai_quota(11);
    RAISE EXCEPTION 'Cost 11 was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    -- Expected
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Cost 0 or 11 raises 22023');

-- 15. User billing protection trigger
DO $$
DECLARE
  v_user_i uuid := gen_random_uuid();
  v_check_cal numeric;
  v_check_trial timestamptz;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_i, 'user_i_guard@test.com');

  -- Impersonate user I
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_i || '"}', true);

  -- 1) Authenticated user attempting to update their own trial_ends_at must throw
  BEGIN
    UPDATE public.users
    SET trial_ends_at = now() + interval '30 days'
    WHERE id = v_user_i;
    RAISE EXCEPTION 'Authenticated user updated trial_ends_at';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Billing and trial fields can only be modified by administrative services%' THEN
      RAISE EXCEPTION 'Unexpected error message on trial_ends_at update: %', SQLERRM;
    END IF;
  END;

  -- 2) Authenticated user updating normal columns (e.g. target_calories, timezone) must succeed
  UPDATE public.users
  SET target_calories = 2450, timezone = 'America/New_York'
  WHERE id = v_user_i;

  SELECT target_calories INTO v_check_cal FROM public.users WHERE id = v_user_i;
  IF v_check_cal <> 2450 THEN
    RAISE EXCEPTION 'Authenticated user failed to update target_calories: %', v_check_cal;
  END IF;

  -- 3) Service role updating trial_ends_at must succeed
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  UPDATE public.users
  SET trial_ends_at = '2027-01-01 00:00:00+00'::timestamptz
  WHERE id = v_user_i;

  SELECT trial_ends_at INTO v_check_trial FROM public.users WHERE id = v_user_i;
  IF v_check_trial <> '2027-01-01 00:00:00+00'::timestamptz THEN
    RAISE EXCEPTION 'service_role update of trial_ends_at failed: %', v_check_trial;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Billing protection trigger prevents client update of trial_ends_at but allows other updates and service_role');

-- 16. Existing protect_user_subscription_fields behavior is untouched
DO $$
DECLARE
  v_user_j uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_j, 'user_j_sub@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_j || '"}', true);

  BEGIN
    UPDATE public.users
    SET coach_tier = 'pro'
    WHERE id = v_user_j;
    RAISE EXCEPTION 'Authenticated user updated coach_tier';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Subscription tiers and athlete quotas can only be modified by administrative payment webhooks%' THEN
      RAISE EXCEPTION 'Unexpected error message on subscription update: %', SQLERRM;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Existing protect_user_subscription_fields behavior is untouched');

SELECT * FROM finish();
ROLLBACK;
