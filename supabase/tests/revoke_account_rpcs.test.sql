BEGIN;
SELECT plan(14);

-- 1. Verify anon lacks EXECUTE on the four account RPCs
SELECT ok(
  NOT has_function_privilege('anon', 'public.disconnect_coach(uuid)', 'EXECUTE'),
  'anon cannot execute disconnect_coach'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.update_athlete_macros(uuid, numeric, numeric, numeric, numeric, numeric)', 'EXECUTE'),
  'anon cannot execute update_athlete_macros'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.set_coach_code(text)', 'EXECUTE'),
  'anon cannot execute set_coach_code'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz, uuid)', 'EXECUTE'),
  'anon cannot execute save_routine_template'
);

-- 2. Verify authenticated has EXECUTE on all four
SELECT ok(
  has_function_privilege('authenticated', 'public.disconnect_coach(uuid)', 'EXECUTE'),
  'authenticated can execute disconnect_coach'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.update_athlete_macros(uuid, numeric, numeric, numeric, numeric, numeric)', 'EXECUTE'),
  'authenticated can execute update_athlete_macros'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.set_coach_code(text)', 'EXECUTE'),
  'authenticated can execute set_coach_code'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz, uuid)', 'EXECUTE'),
  'authenticated can execute save_routine_template'
);

-- 3. Verify service_role has EXECUTE on all four
SELECT ok(
  has_function_privilege('service_role', 'public.disconnect_coach(uuid)', 'EXECUTE'),
  'service_role can execute disconnect_coach'
);
SELECT ok(
  has_function_privilege('service_role', 'public.update_athlete_macros(uuid, numeric, numeric, numeric, numeric, numeric)', 'EXECUTE'),
  'service_role can execute update_athlete_macros'
);
SELECT ok(
  has_function_privilege('service_role', 'public.set_coach_code(text)', 'EXECUTE'),
  'service_role can execute set_coach_code'
);
SELECT ok(
  has_function_privilege('service_role', 'public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz, uuid)', 'EXECUTE'),
  'service_role can execute save_routine_template'
);

-- 4. Behavioral test: anon execution raises insufficient_privilege
DO $$
DECLARE
  v_caught_dc boolean := false;
  v_caught_uam boolean := false;
  v_caught_scc boolean := false;
  v_caught_srt boolean := false;
BEGIN
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claims', '', true);

  -- 1) disconnect_coach
  BEGIN
    PERFORM public.disconnect_coach(gen_random_uuid());
    RAISE EXCEPTION 'anon was able to execute disconnect_coach';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_dc := true;
  END;

  -- 2) update_athlete_macros
  BEGIN
    PERFORM public.update_athlete_macros(gen_random_uuid(), 2000, 150, 200, 60, 30);
    RAISE EXCEPTION 'anon was able to execute update_athlete_macros';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_uam := true;
  END;

  -- 3) set_coach_code
  BEGIN
    PERFORM public.set_coach_code('YB-TEST01');
    RAISE EXCEPTION 'anon was able to execute set_coach_code';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_scc := true;
  END;

  -- 4) save_routine_template
  BEGIN
    PERFORM public.save_routine_template(NULL, 'Anon Routine', ARRAY['Mon']::text[], '[]'::jsonb, gen_random_uuid(), false, NULL, NULL, NULL);
    RAISE EXCEPTION 'anon was able to execute save_routine_template';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught_srt := true;
  END;

  IF NOT (v_caught_dc AND v_caught_uam AND v_caught_scc AND v_caught_srt) THEN
    RAISE EXCEPTION 'Expected insufficient_privilege for all 4 functions, got dc=%, uam=%, scc=%, srt=%',
      v_caught_dc, v_caught_uam, v_caught_scc, v_caught_srt;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('anon execution attempts raise insufficient_privilege on all 4 functions');

-- 5. Behavioral test: authenticated execution succeeds
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_athlete_id uuid := gen_random_uuid();
  v_res_code text;
  v_res_json jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_coach_id, 'auth_coach_revoke@test.com'),
    (v_athlete_id, 'auth_athlete_revoke@test.com');

  UPDATE public.users SET is_coach_mode = true, role = 'coach' WHERE id = v_coach_id;
  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status) VALUES (v_coach_id, v_athlete_id, 'active');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  -- 1) set_coach_code
  v_res_code := public.set_coach_code('YB-REVOKE01');
  IF v_res_code <> 'YB-REVOKE01' THEN
    RAISE EXCEPTION 'set_coach_code failed to return code';
  END IF;

  -- 2) update_athlete_macros
  v_res_json := public.update_athlete_macros(v_athlete_id, 2400, 180, 240, 65, 30);
  IF (v_res_json->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'update_athlete_macros failed';
  END IF;

  -- 3) save_routine_template
  v_res_json := public.save_routine_template(
    NULL, 'Coach Routine', ARRAY['Mon']::text[], '[]'::jsonb, v_coach_id, false, NULL, NULL, NULL
  );
  IF (v_res_json->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'save_routine_template failed';
  END IF;

  -- Switch to athlete context for disconnect_coach
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_id || '"}', true);
  v_res_json := public.disconnect_coach(NULL);
  IF (v_res_json->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'disconnect_coach failed';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('authenticated users can execute all 4 account RPCs');

SELECT * FROM finish();
ROLLBACK;
