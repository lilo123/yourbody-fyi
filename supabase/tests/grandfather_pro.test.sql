BEGIN;
SELECT plan(17);

-- 1. Table and function existence
SELECT has_table('public', 'billing_grandfather', 'public.billing_grandfather table exists');
SELECT has_function('public', 'grandfather_existing_users', 'public.grandfather_existing_users function exists');

-- 2. Check table columns
SELECT has_column('public', 'billing_grandfather', 'user_id', 'billing_grandfather has user_id');
SELECT has_column('public', 'billing_grandfather', 'prev_plan', 'billing_grandfather has prev_plan');
SELECT has_column('public', 'billing_grandfather', 'prev_paid_until', 'billing_grandfather has prev_paid_until');
SELECT has_column('public', 'billing_grandfather', 'granted_until', 'billing_grandfather has granted_until');
SELECT has_column('public', 'billing_grandfather', 'granted_at', 'billing_grandfather has granted_at');

-- 3. RLS is enabled on public.billing_grandfather
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.billing_grandfather'::regclass),
  'RLS is enabled on public.billing_grandfather'
);

-- 4. Authenticated cannot SELECT or INSERT on billing_grandfather
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_test_uid, 'bg_rls_check@test.com');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_test_uid || '"}', true);

  BEGIN
    PERFORM count(*) FROM public.billing_grandfather;
    RAISE EXCEPTION 'authenticated was able to select from billing_grandfather';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  BEGIN
    INSERT INTO public.billing_grandfather (user_id, granted_until)
    VALUES (v_test_uid, now() + interval '1 year');
    RAISE EXCEPTION 'authenticated was able to insert into billing_grandfather';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated cannot SELECT or INSERT on public.billing_grandfather');

-- 5. anon, authenticated, and service_role cannot execute grandfather_existing_users
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_test_uid, 'func_priv_check@test.com');

  -- 1) anon cannot execute
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.grandfather_existing_users();
    RAISE EXCEPTION 'anon was able to execute grandfather_existing_users';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 2) authenticated cannot execute
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_test_uid || '"}', true);
  BEGIN
    PERFORM public.grandfather_existing_users();
    RAISE EXCEPTION 'authenticated was able to execute grandfather_existing_users';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  -- 3) service_role cannot execute
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  BEGIN
    PERFORM public.grandfather_existing_users();
    RAISE EXCEPTION 'service_role was able to execute grandfather_existing_users';
  EXCEPTION WHEN insufficient_privilege THEN
    -- Expected
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('anon, authenticated, and service_role cannot execute grandfather_existing_users');

-- 6. Core grandfathering behavior:
-- - User A: plan NULL -> becomes 'pro', paid_until within 1 min of now() + 1 year
-- - User B: plan 'basic', paid_until now() + 3 years -> becomes 'pro', keeps now() + 3 years
-- - billing_grandfather audit rows recorded with prev_plan and prev_paid_until
DO $$
DECLARE
  v_uid_null uuid := gen_random_uuid();
  v_uid_basic uuid := gen_random_uuid();
  v_future_date timestamptz := now() + interval '3 years';
  v_granted_count integer;
  v_rec_null record;
  v_rec_basic record;
  v_bg_null record;
  v_bg_basic record;
BEGIN
  -- Create User A (plan NULL, paid_until NULL)
  INSERT INTO auth.users (id, email) VALUES (v_uid_null, 'null_plan_user@test.com');

  -- Create User B (plan 'basic', paid_until 3 years in future)
  INSERT INTO auth.users (id, email) VALUES (v_uid_basic, 'basic_future_user@test.com');
  UPDATE public.users
  SET plan = 'basic', paid_until = v_future_date
  WHERE id = v_uid_basic;

  -- Call grandfather_existing_users as postgres/owner
  v_granted_count := public.grandfather_existing_users();
  IF v_granted_count < 2 THEN
    RAISE EXCEPTION 'grandfather_existing_users returned %, expected at least 2', v_granted_count;
  END IF;

  -- Check User A updated state
  SELECT plan, paid_until INTO v_rec_null FROM public.users WHERE id = v_uid_null;
  IF v_rec_null.plan <> 'pro' THEN
    RAISE EXCEPTION 'User A plan is %, expected pro', v_rec_null.plan;
  END IF;
  IF abs(extract(epoch from (v_rec_null.paid_until - (now() + interval '1 year')))) > 60 THEN
    RAISE EXCEPTION 'User A paid_until % is not within 60s of now() + 1 year', v_rec_null.paid_until;
  END IF;

  -- Check User A billing_grandfather audit row
  SELECT prev_plan, prev_paid_until, granted_until INTO v_bg_null
  FROM public.billing_grandfather WHERE user_id = v_uid_null;
  IF v_bg_null.prev_plan IS NOT NULL OR v_bg_null.prev_paid_until IS NOT NULL THEN
    RAISE EXCEPTION 'User A audit record unexpected: prev_plan=%, prev_paid_until=%', v_bg_null.prev_plan, v_bg_null.prev_paid_until;
  END IF;
  IF v_bg_null.granted_until <> v_rec_null.paid_until THEN
    RAISE EXCEPTION 'User A granted_until % does not match paid_until %', v_bg_null.granted_until, v_rec_null.paid_until;
  END IF;

  -- Check User B updated state
  SELECT plan, paid_until INTO v_rec_basic FROM public.users WHERE id = v_uid_basic;
  IF v_rec_basic.plan <> 'pro' THEN
    RAISE EXCEPTION 'User B plan is %, expected pro', v_rec_basic.plan;
  END IF;
  IF v_rec_basic.paid_until <> v_future_date THEN
    RAISE EXCEPTION 'User B paid_until % does not match original future date %', v_rec_basic.paid_until, v_future_date;
  END IF;

  -- Check User B billing_grandfather audit row
  SELECT prev_plan, prev_paid_until, granted_until INTO v_bg_basic
  FROM public.billing_grandfather WHERE user_id = v_uid_basic;
  IF v_bg_basic.prev_plan <> 'basic' OR v_bg_basic.prev_paid_until <> v_future_date THEN
    RAISE EXCEPTION 'User B audit record unexpected: prev_plan=%, prev_paid_until=%', v_bg_basic.prev_plan, v_bg_basic.prev_paid_until;
  END IF;
  IF v_bg_basic.granted_until <> v_future_date THEN
    RAISE EXCEPTION 'User B granted_until % does not match paid_until %', v_bg_basic.granted_until, v_future_date;
  END IF;
END;
$$;
SELECT pass('user with plan NULL becomes plan pro with paid_until within 1 min of now() + 1 year');
SELECT pass('basic user with paid_until now() + 3 years keeps that later date and becomes pro');
SELECT pass('billing_grandfather audit records store accurate prev_plan, prev_paid_until, and granted_until');

-- 7. has_pro is true for grandfathered users
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
  v_is_pro boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_test_uid, 'has_pro_test@test.com');
  PERFORM public.grandfather_existing_users();

  -- Authenticated user checking self
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_test_uid || '"}', true);

  v_is_pro := public.has_pro(v_test_uid);
  IF v_is_pro <> true THEN
    RAISE EXCEPTION 'has_pro returned false for grandfathered user';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('has_pro returns true for grandfathered user');

-- 8. Idempotency: second call returns 0 and mutates nothing
DO $$
DECLARE
  v_second_count integer;
BEGIN
  v_second_count := public.grandfather_existing_users();
  IF v_second_count <> 0 THEN
    RAISE EXCEPTION 'second call returned %, expected 0', v_second_count;
  END IF;
END;
$$;
SELECT pass('second call to grandfather_existing_users returns 0 and modifies no rows');

-- 9. User created AFTER the grandfather call is not grandfathered (plan NULL, has_pro false)
DO $$
DECLARE
  v_new_uid uuid := gen_random_uuid();
  v_plan text;
  v_has_pro boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_new_uid, 'post_grandfather@test.com');

  SELECT plan INTO v_plan FROM public.users WHERE id = v_new_uid;
  IF v_plan IS NOT NULL THEN
    RAISE EXCEPTION 'Post-migration user has unexpected plan: %', v_plan;
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_new_uid || '"}', true);

  v_has_pro := public.has_pro(v_new_uid);
  IF v_has_pro <> false THEN
    RAISE EXCEPTION 'Post-migration user has_pro returned true, expected false';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('user created after grandfathering is not grandfathered (plan NULL, has_pro false)');

-- 10. Deleting a grandfathered user cascades and removes billing_grandfather row
DO $$
DECLARE
  v_del_uid uuid := gen_random_uuid();
  v_bg_count integer;
  v_users_count integer;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_del_uid, 'cascade_del_test@test.com');
  PERFORM public.grandfather_existing_users();

  SELECT count(*) INTO v_bg_count FROM public.billing_grandfather WHERE user_id = v_del_uid;
  IF v_bg_count <> 1 THEN
    RAISE EXCEPTION 'billing_grandfather row missing before delete';
  END IF;

  DELETE FROM auth.users WHERE id = v_del_uid;

  SELECT count(*) INTO v_users_count FROM public.users WHERE id = v_del_uid;
  IF v_users_count <> 0 THEN
    RAISE EXCEPTION 'public.users row was not cascaded';
  END IF;

  SELECT count(*) INTO v_bg_count FROM public.billing_grandfather WHERE user_id = v_del_uid;
  IF v_bg_count <> 0 THEN
    RAISE EXCEPTION 'public.billing_grandfather row was not cascaded';
  END IF;
END;
$$;
SELECT pass('deleting an auth user cascades to public.users and public.billing_grandfather');

SELECT * FROM finish();
ROLLBACK;
