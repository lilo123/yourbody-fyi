BEGIN;
SELECT plan(16);

-- 1. Table & Column assertions
SELECT has_table('public', 'coach_athlete_links', 'coach_athlete_links table exists');
SELECT has_column('public', 'users', 'is_coach_mode', 'users table has is_coach_mode column');
SELECT has_column('public', 'users', 'coach_code', 'users table has coach_code column');
SELECT has_column('public', 'users', 'coach_tier', 'users table has coach_tier column');
SELECT has_column('public', 'users', 'max_athletes', 'users table has max_athletes column');

-- 2. Function existence & search path assertions
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'link_to_coach'
    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  'link_to_coach has explicit search_path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'set_coach_code'
    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  'set_coach_code has explicit search_path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_athlete_macros'
    AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
  ),
  'update_athlete_macros has explicit search_path'
);

-- 3. set_coach_code RPC test
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_generated_code text;
  v_custom_code text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'coach_code_test@example.com', '{"role":"athlete","username":"CoachCodeUser"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  -- Set custom vanity code
  v_custom_code := public.set_coach_code('YB-TEST1');
  IF v_custom_code <> 'YB-TEST1' THEN
    RAISE EXCEPTION 'set_coach_code did not return requested custom code: %', v_custom_code;
  END IF;

  -- Test invalid code regex
  BEGIN
    PERFORM public.set_coach_code('abc');
    RAISE EXCEPTION 'Invalid short coach code was accepted!';
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
SELECT pass('set_coach_code generates and validates coach codes');

-- 4. link_to_coach success, self-link rejection, capacity enforcement
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath1_id uuid := gen_random_uuid();
  v_ath2_id uuid := gen_random_uuid();
  v_ath3_id uuid := gen_random_uuid();
  v_ath4_id uuid := gen_random_uuid();
  v_res jsonb;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_flow@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath1_id, 'ath1_flow@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath2_id, 'ath2_flow@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath3_id, 'ath3_flow@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath4_id, 'ath4_flow@test.com', '{"role":"athlete"}'::jsonb);

  -- Setup coach with capacity 3
  UPDATE public.users 
  SET coach_code = 'YB-CAP3', is_coach_mode = true, max_athletes = 3 
  WHERE id = v_coach_id;

  -- Coach tries to link to self -> rejected
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  v_res := public.link_to_coach('YB-CAP3');
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'Self-coaching was accepted!';
  END IF;

  -- Athlete 1 links
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath1_id || '"}', true);
  v_res := public.link_to_coach('yb-cap3'); -- case insensitivity test
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Athlete 1 link failed: %', v_res;
  END IF;

  -- Athlete 1 links again -> idempotent already_linked
  v_res := public.link_to_coach('YB-CAP3');
  IF (v_res->>'already_linked')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Athlete 1 idempotent relink failed: %', v_res;
  END IF;

  -- Athlete 2 and 3 link
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath2_id || '"}', true);
  PERFORM public.link_to_coach('YB-CAP3');
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath3_id || '"}', true);
  PERFORM public.link_to_coach('YB-CAP3');

  -- Athlete 4 links -> capacity exceeded
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath4_id || '"}', true);
  v_res := public.link_to_coach('YB-CAP3');
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'Athlete 4 linked beyond capacity limit!';
  END IF;
  IF v_res->>'error' NOT LIKE '%maximum athlete capacity%' THEN
    RAISE EXCEPTION 'Unexpected capacity error message: %', v_res;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath1_id, v_ath2_id, v_ath3_id, v_ath4_id);
END;
$$;
SELECT pass('link_to_coach enforces self-link prevention, case-insensitivity, and capacity limits');

-- 5. disconnect_coach test
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_res jsonb;
  v_active_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_disc@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_disc@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-DISC', is_coach_mode = true, max_athletes = 3 WHERE id = v_coach_id;

  -- Link athlete
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-DISC');

  -- Athlete disconnects
  v_res := public.disconnect_coach();
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Disconnect failed: %', v_res;
  END IF;

  SELECT count(*) INTO v_active_count FROM public.coach_athlete_links WHERE athlete_id = v_ath_id AND status = 'active';
  IF v_active_count <> 0 THEN
    RAISE EXCEPTION 'Active link still remained after disconnect';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id);
END;
$$;
SELECT pass('disconnect_coach marks relationship disconnected');

-- 6. update_athlete_macros test
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_unlinked_id uuid := gen_random_uuid();
  v_target_cal numeric;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_mac@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_mac@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_unlinked_id, 'unlinked_mac@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-MAC1', is_coach_mode = true WHERE id = v_coach_id;

  -- Link athlete to coach
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-MAC1');

  -- Coach updates athlete macros
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  PERFORM public.update_athlete_macros(v_ath_id, 2600, 190, 260, 80, 35);

  SELECT target_calories INTO v_target_cal FROM public.users WHERE id = v_ath_id;
  IF v_target_cal <> 2600 THEN
    RAISE EXCEPTION 'Macro target was not updated: expected 2600, got %', v_target_cal;
  END IF;

  -- Unlinked coach attempts to update athlete macros -> rejected
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_unlinked_id || '"}', true);
  BEGIN
    PERFORM public.update_athlete_macros(v_ath_id, 3000, 200, 300, 90, 40);
    RAISE EXCEPTION 'Unlinked user was able to update athlete macros!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unauthorized%' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id, v_unlinked_id);
END;
$$;
SELECT pass('update_athlete_macros allows active coach and rejects unlinked user');

-- 7. Subscription tampering protection
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_uid, 'sub_tamp@test.com', '{"role":"athlete"}'::jsonb);

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_uid || '"}', true);

  -- Athlete attempts to upgrade tier
  BEGIN
    UPDATE public.users SET coach_tier = 'enterprise' WHERE id = v_uid;
    RAISE EXCEPTION 'Client was able to upgrade subscription tier!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unauthorized%' THEN
      RAISE;
    END IF;
  END;

  -- Athlete attempts to increase max_athletes
  BEGIN
    UPDATE public.users SET max_athletes = 100 WHERE id = v_uid;
    RAISE EXCEPTION 'Client was able to upgrade max_athletes quota!';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Unauthorized%' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('protect_user_subscription_fields blocks client updates to tier and capacity');

-- 8. Bidirectional RLS visibility test
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_stranger_id uuid := gen_random_uuid();
  v_seen_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_rls@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_rls@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_stranger_id, 'stranger_rls@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-RLS1', is_coach_mode = true WHERE id = v_coach_id;

  -- Link athlete to coach
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-RLS1');

  -- Athlete can view coach profile
  SELECT count(*) INTO v_seen_count FROM public.users WHERE id = v_coach_id;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Athlete cannot view linked coach profile under scoped RLS';
  END IF;

  -- Athlete CANNOT view stranger profile
  SELECT count(*) INTO v_seen_count FROM public.users WHERE id = v_stranger_id;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant leak: Athlete can view stranger profile!';
  END IF;

  -- Coach can view linked athlete profile
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_seen_count FROM public.users WHERE id = v_ath_id;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Coach cannot view linked athlete profile under scoped RLS';
  END IF;

  -- Coach CANNOT view stranger profile
  SELECT count(*) INTO v_seen_count FROM public.users WHERE id = v_stranger_id;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant leak: Coach can view stranger profile!';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id, v_stranger_id);
END;
$$;
SELECT pass('Users bidirectional RLS allows linked coach/athlete and strictly blocks unlinked strangers');

-- 9. Scoped routine_templates assignment RLS test
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_stranger_id uuid := gen_random_uuid();
  v_tpl_id uuid;
  v_seen_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_tpl@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_tpl@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_stranger_id, 'stranger_tpl@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-TPL1', is_coach_mode = true WHERE id = v_coach_id;

  -- Link athlete to coach
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-TPL1');

  -- Coach saves routine assigned to athlete
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  PERFORM public.save_routine_template(
    p_name := 'Assigned Hypertrophy',
    p_days_of_week := ARRAY['Mon', 'Wed', 'Fri'],
    p_assigned_to := v_ath_id
  );

  SELECT id INTO v_tpl_id FROM public.routine_templates WHERE assigned_to = v_ath_id LIMIT 1;
  IF v_tpl_id IS NULL THEN
    RAISE EXCEPTION 'Routine was not created with assigned_to';
  END IF;

  -- Athlete can see assigned routine
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  SELECT count(*) INTO v_seen_count FROM public.routine_templates WHERE id = v_tpl_id;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Athlete cannot see coach-assigned routine!';
  END IF;

  -- Stranger cannot see assigned routine
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_stranger_id || '"}', true);
  SELECT count(*) INTO v_seen_count FROM public.routine_templates WHERE id = v_tpl_id;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant leak: Stranger can see coach-assigned routine!';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.routine_templates WHERE id = v_tpl_id;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id, v_stranger_id);
END;
$$;
SELECT pass('Routine templates assignment RLS strictly isolates coach-assigned routines to athlete');

-- 10. Scoped workouts, sets, and nutrition_logs RLS for linked vs unlinked coaches
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_ath_id uuid := gen_random_uuid();
  v_stranger_coach_id uuid := gen_random_uuid();
  v_wid uuid;
  v_eid uuid;
  v_nid uuid;
  v_seen_count int;
  v_del_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_coach_id, 'coach_iso@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_ath_id, 'ath_iso@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_stranger_coach_id, 'stranger_c@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-ISO1', is_coach_mode = true WHERE id = v_coach_id;
  UPDATE public.users SET coach_code = 'YB-ISO2', is_coach_mode = true WHERE id = v_stranger_coach_id;

  -- Link athlete to coach 1
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.link_to_coach('YB-ISO1');

  -- Athlete creates workout, set, and nutrition log
  SELECT id INTO v_eid FROM public.exercises WHERE is_master = true LIMIT 1;
  INSERT INTO public.workouts (user_id, name, date) VALUES (v_ath_id, 'Athlete Iso Workout', now()) RETURNING id INTO v_wid;
  INSERT INTO public.sets (workout_id, exercise_id, set_index, weight, reps) VALUES (v_wid, v_eid, 1, 225, 5);
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, protein, carbs, fat, fiber)
  VALUES (v_ath_id, 'Athlete Iso Shake', 400, 40, 30, 5, 2) RETURNING id INTO v_nid;

  -- 1. Linked Coach can view athlete's workout, sets, and nutrition log
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_seen_count FROM public.workouts WHERE id = v_wid;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Linked coach cannot view athlete workout';
  END IF;
  SELECT count(*) INTO v_seen_count FROM public.sets WHERE workout_id = v_wid;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Linked coach cannot view athlete sets';
  END IF;
  SELECT count(*) INTO v_seen_count FROM public.nutrition_logs WHERE id = v_nid;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'Linked coach cannot view athlete nutrition log';
  END IF;

  -- 2. Unlinked Coach CANNOT view athlete's workout, sets, or nutrition log
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_stranger_coach_id || '"}', true);
  SELECT count(*) INTO v_seen_count FROM public.workouts WHERE id = v_wid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Security breach: Unlinked coach can view athlete workout!';
  END IF;
  SELECT count(*) INTO v_seen_count FROM public.sets WHERE workout_id = v_wid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Security breach: Unlinked coach can view athlete sets!';
  END IF;
  SELECT count(*) INTO v_seen_count FROM public.nutrition_logs WHERE id = v_nid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Security breach: Unlinked coach can view athlete nutrition log!';
  END IF;

  -- 3. Unlinked Coach CANNOT delete athlete's workout or nutrition log
  DELETE FROM public.workouts WHERE id = v_wid;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count > 0 THEN
    RAISE EXCEPTION 'Security breach: Unlinked coach deleted athlete workout!';
  END IF;

  DELETE FROM public.nutrition_logs WHERE id = v_nid;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count > 0 THEN
    RAISE EXCEPTION 'Security breach: Unlinked coach deleted athlete nutrition log!';
  END IF;

  -- 4. After disconnect, former coach CANNOT view athlete's records
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath_id || '"}', true);
  PERFORM public.disconnect_coach();

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);
  SELECT count(*) INTO v_seen_count FROM public.workouts WHERE id = v_wid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Security breach: Disconnected former coach can still view athlete workout!';
  END IF;
  SELECT count(*) INTO v_seen_count FROM public.nutrition_logs WHERE id = v_nid;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'Security breach: Disconnected former coach can still view athlete nutrition logs!';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.workouts WHERE id = v_wid;
  DELETE FROM public.nutrition_logs WHERE id = v_nid;
  DELETE FROM auth.users WHERE id IN (v_coach_id, v_ath_id, v_stranger_coach_id);
END;
$$;
SELECT pass('Workouts, sets, and nutrition RLS strictly isolates records to linked coach and blocks unlinked/disconnected coaches');

SELECT * FROM finish();
ROLLBACK;
