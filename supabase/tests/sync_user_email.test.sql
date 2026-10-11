BEGIN;
SELECT plan(6);

-- ============================================================================
-- 1. Function & Trigger Existence Assertions
-- ============================================================================
SELECT has_function('public', 'sync_user_email', 'sync_user_email function exists');
SELECT has_trigger('auth', 'users', 'on_auth_user_email_updated', 'on_auth_user_email_updated trigger exists on auth.users');

-- ============================================================================
-- 2. Email Change Sync Assertion & Isolation (other users untouched)
-- ============================================================================
DO $$
DECLARE
  v_user_1 uuid := gen_random_uuid();
  v_user_2 uuid := gen_random_uuid();
  v_email_1_init text := 'user1_init@example.com';
  v_email_2_init text := 'user2_init@example.com';
  v_email_1_new text := 'user1_new@example.com';
  v_read_email_1 text;
  v_read_email_2 text;
BEGIN
  -- Insert two users into auth.users (trigger handle_new_user populates public.users)
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_user_1, v_email_1_init, '{"role":"athlete","username":"UserOne"}'::jsonb),
    (v_user_2, v_email_2_init, '{"role":"athlete","username":"UserTwo"}'::jsonb);

  -- Verify initial state in public.users
  SELECT email INTO v_read_email_1 FROM public.users WHERE id = v_user_1;
  SELECT email INTO v_read_email_2 FROM public.users WHERE id = v_user_2;

  IF v_read_email_1 <> v_email_1_init THEN
    RAISE EXCEPTION 'User 1 initial email mismatch: expected %, got %', v_email_1_init, v_read_email_1;
  END IF;
  IF v_read_email_2 <> v_email_2_init THEN
    RAISE EXCEPTION 'User 2 initial email mismatch: expected %, got %', v_email_2_init, v_read_email_2;
  END IF;

  -- Update email of user 1 in auth.users
  UPDATE auth.users SET email = v_email_1_new WHERE id = v_user_1;

  -- Check user 1 in public.users is updated
  SELECT email INTO v_read_email_1 FROM public.users WHERE id = v_user_1;
  IF v_read_email_1 <> v_email_1_new THEN
    RAISE EXCEPTION 'User 1 email was not synced to public.users: expected %, got %', v_email_1_new, v_read_email_1;
  END IF;

  -- Check user 2 in public.users is UNTOUCHED
  SELECT email INTO v_read_email_2 FROM public.users WHERE id = v_user_2;
  IF v_read_email_2 <> v_email_2_init THEN
    RAISE EXCEPTION 'User 2 email was unexpectedly modified: expected %, got %', v_email_2_init, v_read_email_2;
  END IF;

  DELETE FROM auth.users WHERE id IN (v_user_1, v_user_2);
END;
$$;

SELECT pass('email change on auth.users updates public.users');
SELECT pass('other users remain untouched when one user updates email');

-- ============================================================================
-- 3. Unrelated Update & Same-Email Update Assertions
-- ============================================================================
DO $$
DECLARE
  v_user_3 uuid := gen_random_uuid();
  v_email_3 text := 'user3_stay@example.com';
  v_read_email text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user_3, v_email_3, '{"role":"athlete","username":"UserThree"}'::jsonb);

  -- Unrelated update: change raw_user_meta_data only
  UPDATE auth.users
  SET raw_user_meta_data = '{"role":"athlete","username":"UserThreeUpdated"}'::jsonb
  WHERE id = v_user_3;

  SELECT email INTO v_read_email FROM public.users WHERE id = v_user_3;
  IF v_read_email <> v_email_3 THEN
    RAISE EXCEPTION 'User 3 email modified on unrelated update: expected %, got %', v_email_3, v_read_email;
  END IF;

  -- Same-email update: OLD.email IS NOT DISTINCT FROM NEW.email
  UPDATE auth.users
  SET email = v_email_3
  WHERE id = v_user_3;

  SELECT email INTO v_read_email FROM public.users WHERE id = v_user_3;
  IF v_read_email <> v_email_3 THEN
    RAISE EXCEPTION 'User 3 email modified on same-email update: expected %, got %', v_email_3, v_read_email;
  END IF;

  DELETE FROM auth.users WHERE id = v_user_3;
END;
$$;

SELECT pass('unrelated update on auth.users does not touch public.users email');
SELECT pass('same-email update on auth.users does not trigger change');

SELECT * FROM finish();
ROLLBACK;
