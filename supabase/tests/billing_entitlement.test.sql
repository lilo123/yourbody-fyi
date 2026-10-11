BEGIN;
SELECT plan(25);

-- 1. Check columns exist on public.users
SELECT has_column('public', 'users', 'plan', 'public.users has plan column');
SELECT has_column('public', 'users', 'paid_until', 'public.users has paid_until column');
SELECT has_column('public', 'users', 'billing_customer_id', 'public.users has billing_customer_id column');

-- 2. Check constraint on plan ('free', 'basic', 'pro')
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_test_uid, 'plan_check@test.com');
  BEGIN
    UPDATE public.users SET plan = 'invalid_tier' WHERE id = v_test_uid;
    RAISE EXCEPTION 'Invalid plan was accepted';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;
END;
$$;
SELECT pass('users_plan_check constraint enforces valid plan tiers');

-- 3. Partial unique index on billing_customer_id
DO $$
DECLARE
  v_uid1 uuid := gen_random_uuid();
  v_uid2 uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_uid1, 'cust1@test.com'), (v_uid2, 'cust2@test.com');
  UPDATE public.users SET billing_customer_id = 'cus_unique_123' WHERE id = v_uid1;

  BEGIN
    UPDATE public.users SET billing_customer_id = 'cus_unique_123' WHERE id = v_uid2;
    RAISE EXCEPTION 'Duplicate non-null billing_customer_id was accepted';
  EXCEPTION WHEN unique_violation THEN
    -- Expected: partial unique index blocks duplicate
  END;
END;
$$;
SELECT pass('billing_customer_id partial unique index blocks duplicate non-null customer IDs');

-- 4. public.billing_events exists and has RLS enabled
SELECT has_table('public', 'billing_events', 'public.billing_events table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_events'::regclass),
  'RLS is enabled on public.billing_events'
);

-- 5. billing_events is inaccessible to authenticated (SELECT, INSERT, UPDATE)
DO $$
DECLARE
  v_auth_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_auth_uid, 'billing_events_rls@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_auth_uid || '"}', true);

  -- 1) INSERT blocked
  BEGIN
    INSERT INTO public.billing_events (event_id, type, user_id)
    VALUES ('evt_test_1', 'invoice.paid', v_auth_uid);
    RAISE EXCEPTION 'Authenticated INSERT into billing_events was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 2) SELECT blocked
  BEGIN
    PERFORM count(*) FROM public.billing_events;
    RAISE EXCEPTION 'Authenticated SELECT from billing_events was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 3) UPDATE blocked
  BEGIN
    UPDATE public.billing_events SET processed_at = now() WHERE event_id = 'evt_test_1';
    RAISE EXCEPTION 'Authenticated UPDATE on billing_events was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated cannot INSERT into billing_events');
SELECT pass('authenticated cannot SELECT from billing_events');
SELECT pass('authenticated cannot UPDATE billing_events');

-- 6. Billing protection trigger blocks client updates of billing fields while allowing other updates
DO $$
DECLARE
  v_user_test uuid := gen_random_uuid();
  v_check_val numeric;
  v_check_plan text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user_test, 'guard_client@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_test || '"}', true);

  -- 1) plan update throws
  BEGIN
    UPDATE public.users SET plan = 'pro' WHERE id = v_user_test;
    RAISE EXCEPTION 'Authenticated updated plan';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Billing and trial fields can only be modified by administrative services%' THEN
      RAISE EXCEPTION 'Unexpected error message on plan update: %', SQLERRM;
    END IF;
  END;

  -- 2) paid_until update throws
  BEGIN
    UPDATE public.users SET paid_until = now() + interval '30 days' WHERE id = v_user_test;
    RAISE EXCEPTION 'Authenticated updated paid_until';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Billing and trial fields can only be modified by administrative services%' THEN
      RAISE EXCEPTION 'Unexpected error message on paid_until update: %', SQLERRM;
    END IF;
  END;

  -- 3) billing_customer_id update throws
  BEGIN
    UPDATE public.users SET billing_customer_id = 'cus_hacked' WHERE id = v_user_test;
    RAISE EXCEPTION 'Authenticated updated billing_customer_id';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Billing and trial fields can only be modified by administrative services%' THEN
      RAISE EXCEPTION 'Unexpected error message on billing_customer_id update: %', SQLERRM;
    END IF;
  END;

  -- 4) trial_ends_at update throws
  BEGIN
    UPDATE public.users SET trial_ends_at = now() + interval '30 days' WHERE id = v_user_test;
    RAISE EXCEPTION 'Authenticated updated trial_ends_at';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Billing and trial fields can only be modified by administrative services%' THEN
      RAISE EXCEPTION 'Unexpected error message on trial_ends_at update: %', SQLERRM;
    END IF;
  END;

  -- 5) Other columns stay updatable
  UPDATE public.users SET target_calories = 2800 WHERE id = v_user_test;
  SELECT target_calories INTO v_check_val FROM public.users WHERE id = v_user_test;
  IF v_check_val <> 2800 THEN
    RAISE EXCEPTION 'Target calories not updated: %', v_check_val;
  END IF;

  -- 6) service_role can update billing fields
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  UPDATE public.users
  SET plan = 'pro', paid_until = '2028-01-01 00:00:00+00'::timestamptz, billing_customer_id = 'cus_admin_set'
  WHERE id = v_user_test;

  SELECT plan INTO v_check_plan FROM public.users WHERE id = v_user_test;
  IF v_check_plan <> 'pro' THEN
    RAISE EXCEPTION 'Service role update of plan failed: %', v_check_plan;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Billing protection trigger blocks authenticated updating billing fields and allows service_role');

-- 7. has_pro helper function behavior
DO $$
DECLARE
  v_pro_uid uuid := gen_random_uuid();
  v_expired_pro_uid uuid := gen_random_uuid();
  v_basic_uid uuid := gen_random_uuid();
  v_null_uid uuid := gen_random_uuid();
  v_res boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_pro_uid, 'pro_user@test.com'),
    (v_expired_pro_uid, 'expired_pro@test.com'),
    (v_basic_uid, 'basic_user@test.com'),
    (v_null_uid, 'null_plan@test.com');

  UPDATE public.users SET plan = 'pro', paid_until = now() + interval '30 days' WHERE id = v_pro_uid;
  UPDATE public.users SET plan = 'pro', paid_until = now() - interval '1 day' WHERE id = v_expired_pro_uid;
  UPDATE public.users SET plan = 'basic', paid_until = now() + interval '30 days' WHERE id = v_basic_uid;
  UPDATE public.users SET plan = NULL, paid_until = NULL WHERE id = v_null_uid;

  -- 1) Pro user inquiring about self -> true
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_pro_uid || '"}', true);
  v_res := public.has_pro(v_pro_uid);
  IF v_res <> true THEN RAISE EXCEPTION 'has_pro returned % instead of true for active pro', v_res; END IF;

  -- 2) Expired pro user -> false
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_expired_pro_uid || '"}', true);
  v_res := public.has_pro(v_expired_pro_uid);
  IF v_res <> false THEN RAISE EXCEPTION 'has_pro returned % instead of false for expired pro', v_res; END IF;

  -- 3) Basic user -> false
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_basic_uid || '"}', true);
  v_res := public.has_pro(v_basic_uid);
  IF v_res <> false THEN RAISE EXCEPTION 'has_pro returned % instead of false for basic user', v_res; END IF;

  -- 4) NULL plan user -> false
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_null_uid || '"}', true);
  v_res := public.has_pro(v_null_uid);
  IF v_res <> false THEN RAISE EXCEPTION 'has_pro returned % instead of false for null plan', v_res; END IF;
  v_res := public.has_pro(NULL);
  IF v_res <> false THEN RAISE EXCEPTION 'has_pro returned % instead of false for NULL input', v_res; END IF;

  -- 5) Asking about another user as authenticated -> false
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_basic_uid || '"}', true);
  v_res := public.has_pro(v_pro_uid);
  IF v_res <> false THEN RAISE EXCEPTION 'has_pro allowed asking about another user as authenticated: %', v_res; END IF;

  -- 6) Asking about another user as service_role -> true
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_res := public.has_pro(v_pro_uid);
  IF v_res <> true THEN RAISE EXCEPTION 'has_pro returned % instead of true for service_role querying pro user', v_res; END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('has_pro: true for pro with future paid_until');
SELECT pass('has_pro: false when expired');
SELECT pass('has_pro: false for basic');
SELECT pass('has_pro: false for NULL plan or NULL argument');
SELECT pass('has_pro: false when asking about another user as authenticated');
SELECT pass('has_pro: true when asking about another pro user as service_role');

-- 8. ai_plan_for and consume_ai_quota integration
DO $$
DECLARE
  v_basic_user uuid := gen_random_uuid();
  v_pro_user uuid := gen_random_uuid();
  v_expired_pro uuid := gen_random_uuid();
  v_trial_user uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_basic_user, 'basic_quota@test.com'),
    (v_pro_user, 'pro_quota@test.com'),
    (v_expired_pro, 'expired_pro_quota@test.com'),
    (v_trial_user, 'trial_quota@test.com');

  UPDATE public.users SET plan = 'basic', paid_until = now() + interval '30 days' WHERE id = v_basic_user;
  UPDATE public.users SET plan = 'pro', paid_until = now() + interval '30 days' WHERE id = v_pro_user;
  UPDATE public.users SET plan = 'pro', paid_until = now() - interval '5 days', created_at = now() - interval '30 days', trial_ends_at = NULL WHERE id = v_expired_pro;
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() WHERE id = v_trial_user;

  -- 1) Basic user: limit 5 per day
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_basic_user || '"}', true);
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> true
     OR v_res->>'plan' <> 'basic'
     OR (v_res->>'limit')::integer <> 5
     OR v_res->>'period' <> 'day' THEN
    RAISE EXCEPTION 'Basic user consume unexpected: %', v_res;
  END IF;

  -- 2) Pro user: limit 30 per day
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_pro_user || '"}', true);
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> true
     OR v_res->>'plan' <> 'pro'
     OR (v_res->>'limit')::integer <> 30
     OR v_res->>'period' <> 'day' THEN
    RAISE EXCEPTION 'Pro user consume unexpected: %', v_res;
  END IF;

  -- 3) Expired pro past trial: plan free (limit 0, denied)
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_expired_pro || '"}', true);
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> false
     OR v_res->>'plan' <> 'free'
     OR (v_res->>'limit')::integer <> 0 THEN
    RAISE EXCEPTION 'Expired pro consume unexpected: %', v_res;
  END IF;

  -- 4) Trial user: plan trial (limit 30 per day)
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_trial_user || '"}', true);
  v_res := public.consume_ai_quota(1);
  IF (v_res->>'allowed')::boolean <> true
     OR v_res->>'plan' <> 'trial'
     OR (v_res->>'limit')::integer <> 30
     OR v_res->>'period' <> 'day' THEN
    RAISE EXCEPTION 'Trial user consume unexpected: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('consume_ai_quota: basic user gets limit 5 per day');
SELECT pass('consume_ai_quota: pro user gets limit 30 per day');
SELECT pass('consume_ai_quota: expired pro past trial resolves to free (limit 0)');
SELECT pass('consume_ai_quota: trial user resolves to trial (limit 30 per day)');

-- 9. get_my_entitlement RPC tests
DO $$
DECLARE
  v_ent_trial uuid := gen_random_uuid();
  v_ent_pro uuid := gen_random_uuid();
  v_ent_free uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_ent_trial, 'ent_trial@test.com'),
    (v_ent_pro, 'ent_pro@test.com'),
    (v_ent_free, 'ent_free@test.com');

  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() WHERE id = v_ent_trial;
  UPDATE public.users SET plan = 'pro', paid_until = now() + interval '30 days' WHERE id = v_ent_pro;
  UPDATE public.users SET plan = NULL, paid_until = NULL, created_at = now() - interval '30 days', trial_ends_at = NULL WHERE id = v_ent_free;

  -- 1) Trial user
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ent_trial || '"}', true);
  v_res := public.get_my_entitlement();
  IF v_res->>'plan_effective' <> 'trial'
     OR v_res->>'plan' IS NOT NULL
     OR v_res->>'paid_until' IS NOT NULL
     OR (v_res->>'has_pro')::boolean <> false
     OR v_res->>'trial_ends_at_effective' IS NULL THEN
    RAISE EXCEPTION 'Trial entitlement unexpected: %', v_res;
  END IF;

  -- 2) Pro user
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ent_pro || '"}', true);
  v_res := public.get_my_entitlement();
  IF v_res->>'plan_effective' <> 'pro'
     OR v_res->>'plan' <> 'pro'
     OR v_res->>'paid_until' IS NULL
     OR (v_res->>'has_pro')::boolean <> true THEN
    RAISE EXCEPTION 'Pro entitlement unexpected: %', v_res;
  END IF;

  -- 3) Free user
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ent_free || '"}', true);
  v_res := public.get_my_entitlement();
  IF v_res->>'plan_effective' <> 'free'
     OR v_res->>'plan' IS NOT NULL
     OR v_res->>'paid_until' IS NOT NULL
     OR (v_res->>'has_pro')::boolean <> false THEN
    RAISE EXCEPTION 'Free entitlement unexpected: %', v_res;
  END IF;

  -- 4) Unauthenticated calls raise exception
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.get_my_entitlement();
    RAISE EXCEPTION 'Anon call to get_my_entitlement was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected: execute revoked from anon
  END;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.get_my_entitlement();
    RAISE EXCEPTION 'Authenticated call without sub to get_my_entitlement was accepted';
  EXCEPTION WHEN SQLSTATE '28000' THEN
    -- Expected: 28000 raised
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('get_my_entitlement: returns expected JSON for trial user');
SELECT pass('get_my_entitlement: returns expected JSON for pro user');
SELECT pass('get_my_entitlement: returns expected JSON for free user');
SELECT pass('get_my_entitlement: raises when unauthenticated (anon revoked, no uid raises 28000)');

SELECT * FROM finish();
ROLLBACK;
