BEGIN;
SELECT plan(11);

-- 1. Table & column assertions
SELECT has_table('public', 'users', 'users table exists');
SELECT has_column('public', 'users', 'timezone', 'users table has timezone column');
SELECT col_is_null('public', 'users', 'timezone', 'users.timezone column is nullable');
SELECT col_type_is('public', 'users', 'timezone', 'text', 'users.timezone column is type text');

-- 2. RLS UPDATE policy: user A cannot update user B's timezone
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_updated_rows int;
BEGIN
  -- Insert test users directly into auth.users (handle_new_user trigger creates public.users rows)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_user_a, 'user_a_tz@example.com', '{"role":"athlete","username":"UserA"}'::jsonb),
    (v_user_b, 'user_b_tz@example.com', '{"role":"athlete","username":"UserB"}'::jsonb);

  -- Impersonate User A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);

  -- User A updates own timezone -> succeeds (1 row affected)
  UPDATE public.users SET timezone = 'America/New_York' WHERE id = v_user_a;
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 1 THEN
    RAISE EXCEPTION 'User A should be able to update own timezone, updated rows: %', v_updated_rows;
  END IF;

  -- User A attempts to update User B's timezone -> blocked by RLS (0 rows affected)
  UPDATE public.users SET timezone = 'Asia/Tokyo' WHERE id = v_user_b;
  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows <> 0 THEN
    RAISE EXCEPTION 'User A must not be able to update User B timezone, updated rows: %', v_updated_rows;
  END IF;

  PERFORM set_config('role', 'postgres', true);
END;
$$;

SELECT pass('User A successfully updated own timezone');
SELECT pass('User A was blocked from updating User B timezone by RLS');

-- 3. nutrition_logs.logged_date schema assertions
SELECT has_column('public', 'nutrition_logs', 'logged_date', 'nutrition_logs table has logged_date column');
SELECT col_is_null('public', 'nutrition_logs', 'logged_date', 'nutrition_logs.logged_date is nullable before timezone sync');
SELECT col_type_is('public', 'nutrition_logs', 'logged_date', 'date', 'nutrition_logs.logged_date is type date');

-- 4. nutrition_logs.logged_date trigger assertions (both on insert and on first user timezone sync)
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_log_pre_tz uuid;
  v_date_pre date;
  v_date_1 date;
  v_date_2 date;
BEGIN
  PERFORM set_config('role', 'postgres', true);

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user, 'user_tz_nl@example.com', '{"role":"athlete","username":"UserNL"}'::jsonb);

  -- Insert a log while user timezone is still NULL -> logged_date stays NULL (not stamped with an arbitrary zone)
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, logged_at)
  VALUES (v_user, 'Pre-Sync Snack', 250, '2026-09-23 02:00:00+00')
  RETURNING id, logged_date INTO v_log_pre_tz, v_date_pre;

  IF v_date_pre IS NOT NULL THEN
    RAISE EXCEPTION 'Expected pre-sync logged_date to be NULL, got %', v_date_pre;
  END IF;

  -- Now user's device syncs timezone -> trigger automatically backfills NULL logged_date in user's real zone
  UPDATE public.users SET timezone = 'America/New_York' WHERE id = v_user;

  SELECT logged_date INTO v_date_pre FROM public.nutrition_logs WHERE id = v_log_pre_tz;
  IF v_date_pre <> '2026-09-22'::date THEN
    RAISE EXCEPTION 'Expected backfilled logged_date to be 2026-09-22 after timezone sync, got %', v_date_pre;
  END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user || '"}', true);

  -- Insert without logged_date after timezone is known; 02:00 UTC on 2026-09-23 is 22:00 EDT on 2026-09-22
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, logged_at)
  VALUES (v_user, 'Late Night Snack', 300, '2026-09-23 02:00:00+00')
  RETURNING logged_date INTO v_date_1;

  IF v_date_1 <> '2026-09-22'::date THEN
    RAISE EXCEPTION 'Expected logged_date to be 2026-09-22, got %', v_date_1;
  END IF;

  -- Insert with explicit logged_date
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, logged_at, logged_date)
  VALUES (v_user, 'Explicit Date Meal', 500, '2026-09-23 02:00:00+00', '2026-09-20'::date)
  RETURNING logged_date INTO v_date_2;

  IF v_date_2 <> '2026-09-20'::date THEN
    RAISE EXCEPTION 'Expected logged_date to be 2026-09-20, got %', v_date_2;
  END IF;

  PERFORM set_config('role', 'postgres', true);
END;
$$;

SELECT pass('nutrition_logs triggers auto-backfill on first timezone sync and auto-populate on insert');
SELECT pass('nutrition_logs trigger preserves explicit logged_date when provided');

SELECT * FROM finish();
ROLLBACK;
