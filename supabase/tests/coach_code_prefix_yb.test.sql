BEGIN;
SELECT plan(5);

-- ============================================================================
-- 1. Generated coach code starts with 'YB-'
-- ============================================================================
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_generated_code text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'coach_gen_test@example.com', '{"role":"athlete","username":"CoachGenTest"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  -- Call set_coach_code() without parameters (auto-generation branch)
  v_generated_code := public.set_coach_code();
  IF v_generated_code NOT LIKE 'YB-%' THEN
    RAISE EXCEPTION 'Generated coach code does not start with YB-: %', v_generated_code;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('set_coach_code auto-generated code starts with YB-');

-- ============================================================================
-- 2. Custom coach code is still accepted
-- ============================================================================
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_custom_code text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'coach_custom_test@example.com', '{"role":"athlete","username":"CoachCustomTest"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  v_custom_code := public.set_coach_code('CUSTOM-123');
  IF v_custom_code <> 'CUSTOM-123' THEN
    RAISE EXCEPTION 'set_coach_code did not return requested custom code: %', v_custom_code;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('set_coach_code accepts valid custom code');

-- ============================================================================
-- 3. Validation regex still rejects invalid coach codes
-- ============================================================================
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'coach_bad_test@example.com', '{"role":"athlete","username":"CoachBadTest"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  -- Short code (<4 chars)
  BEGIN
    PERFORM public.set_coach_code('ab');
    RAISE EXCEPTION 'Short coach code was accepted!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Coach code must be 4-20 alphanumeric characters%' THEN
      RAISE;
    END IF;
  END;

  -- Invalid characters
  BEGIN
    PERFORM public.set_coach_code('BAD$CODE');
    RAISE EXCEPTION 'Invalid character coach code was accepted!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Coach code must be 4-20 alphanumeric characters%' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('set_coach_code rejects codes violating regex');

-- ============================================================================
-- 4. Rewrite DO block rewrites CYBER- row to YB- preserving other columns
-- ============================================================================
DO $$
DECLARE
  v_test_uid uuid := gen_random_uuid();
  v_before_md5 text;
  v_after_md5 text;
  v_new_code text;
  -- Rewrite DO block variables copied verbatim from supabase/migrations/20261001000000_coach_code_prefix_yb.sql (lines 53-86)
  v_collision_count integer;
  v_invalid_count integer;
BEGIN
  -- Insert a CYBER- row for rewrite testing
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_test_uid, 'rewrite_test@example.com', '{"role":"coach","username":"RewriteCoach"}'::jsonb);

  UPDATE public.users
  SET coach_code = 'CYBER-REWRITE99', is_coach_mode = true
  WHERE id = v_test_uid;

  SELECT md5((to_jsonb(users) - 'coach_code')::text) INTO v_before_md5
  FROM public.users WHERE id = v_test_uid;

  -- REWRITE DO BLOCK: copied verbatim from supabase/migrations/20261001000000_coach_code_prefix_yb.sql (lines 53-86)
  SELECT count(*) INTO v_collision_count
  FROM public.users c
  WHERE c.coach_code LIKE 'CYBER-%'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE UPPER(u.coach_code) = UPPER('YB-' || substr(c.coach_code, 7))
    );

  IF v_collision_count > 0 THEN
    RAISE EXCEPTION 'M11 migration aborted: % target YB- coach code(s) already exist', v_collision_count;
  END IF;

  SELECT count(*) INTO v_invalid_count
  FROM public.users c
  WHERE c.coach_code LIKE 'CYBER-%'
    AND NOT (('YB-' || substr(c.coach_code, 7)) ~ '^[A-Z0-9_-]{4,20}$');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'M11 migration aborted: % target YB- coach code(s) fail regex ^[A-Z0-9_-]{4,20}$', v_invalid_count;
  END IF;

  UPDATE public.users
  SET coach_code = 'YB-' || substr(coach_code, 7)
  WHERE coach_code LIKE 'CYBER-%';
  -- END REWRITE DO BLOCK

  SELECT coach_code, md5((to_jsonb(users) - 'coach_code')::text)
  INTO v_new_code, v_after_md5
  FROM public.users WHERE id = v_test_uid;

  IF v_new_code <> 'YB-REWRITE99' THEN
    RAISE EXCEPTION 'Expected coach_code YB-REWRITE99, got %', v_new_code;
  END IF;

  IF v_before_md5 <> v_after_md5 THEN
    RAISE EXCEPTION 'MD5 checksum over other columns changed during rewrite: before %, after %', v_before_md5, v_after_md5;
  END IF;

  DELETE FROM auth.users WHERE id = v_test_uid;
END;
$$;
SELECT pass('Migration rewrite DO block rewrites CYBER- row to YB- preserving other columns');

-- ============================================================================
-- 5. Planted collision causes rewrite DO block to abort
-- ============================================================================
DO $$
DECLARE
  v_uid_cyber uuid := gen_random_uuid();
  v_uid_yb uuid := gen_random_uuid();
  v_threw boolean := false;
  -- Rewrite DO block variables copied verbatim from supabase/migrations/20261001000000_coach_code_prefix_yb.sql (lines 53-86)
  v_collision_count integer;
  v_invalid_count integer;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid_cyber, 'collision_cyber@test.com', '{"role":"coach"}'::jsonb),
         (v_uid_yb, 'collision_yb@test.com', '{"role":"coach"}'::jsonb);

  UPDATE public.users SET coach_code = 'CYBER-COLLIDE1' WHERE id = v_uid_cyber;
  UPDATE public.users SET coach_code = 'YB-COLLIDE1' WHERE id = v_uid_yb;

  BEGIN
    -- REWRITE DO BLOCK: copied verbatim from supabase/migrations/20261001000000_coach_code_prefix_yb.sql (lines 53-86)
    SELECT count(*) INTO v_collision_count
    FROM public.users c
    WHERE c.coach_code LIKE 'CYBER-%'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE UPPER(u.coach_code) = UPPER('YB-' || substr(c.coach_code, 7))
      );

    IF v_collision_count > 0 THEN
      RAISE EXCEPTION 'M11 migration aborted: % target YB- coach code(s) already exist', v_collision_count;
    END IF;

    SELECT count(*) INTO v_invalid_count
    FROM public.users c
    WHERE c.coach_code LIKE 'CYBER-%'
      AND NOT (('YB-' || substr(c.coach_code, 7)) ~ '^[A-Z0-9_-]{4,20}$');

    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'M11 migration aborted: % target YB- coach code(s) fail regex ^[A-Z0-9_-]{4,20}$', v_invalid_count;
    END IF;

    UPDATE public.users
    SET coach_code = 'YB-' || substr(coach_code, 7)
    WHERE coach_code LIKE 'CYBER-%';
    -- END REWRITE DO BLOCK
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%M11 migration aborted%target YB- coach code(s) already exist%' THEN
      v_threw := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_threw THEN
    RAISE EXCEPTION 'Planted collision did not throw abort exception!';
  END IF;

  DELETE FROM auth.users WHERE id IN (v_uid_cyber, v_uid_yb);
END;
$$;
SELECT pass('Planted collision causes rewrite DO block to abort');

SELECT * FROM finish();
ROLLBACK;
