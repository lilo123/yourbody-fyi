BEGIN;
SELECT plan(13);

DO $$
DECLARE
  v_coach_a uuid := gen_random_uuid();
  v_coach_b uuid := gen_random_uuid();
  v_master_a_id uuid := gen_random_uuid();
  v_master_rpc_id uuid := gen_random_uuid();
  v_platform_id uuid;
  v_ex_id uuid;
  v_te_a_id uuid := gen_random_uuid();
  v_platform_te_id uuid;
  v_rows int;
  v_res jsonb;
BEGIN
  -- 1. Setup users
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_coach_a, 'coach_a_rls@test.com', '{"role":"coach"}'::jsonb),
    (v_coach_b, 'coach_b_rls@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id IN (v_coach_a, v_coach_b);

  -- 2. Setup exercises
  SELECT id INTO v_ex_id FROM public.exercises WHERE is_master = true LIMIT 1;

  -- 3. Coach A creates master routine templates and exercise
  INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
  VALUES (v_master_a_id, v_coach_a, 'Coach A Master Routine', true, ARRAY['Monday']::text[]);

  INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
  VALUES (v_master_rpc_id, v_coach_a, 'Coach A Master Routine For RPC', true, ARRAY['Tuesday']::text[]);

  INSERT INTO public.template_exercises (id, template_id, exercise_id, order_index, target_sets, target_reps)
  VALUES (v_te_a_id, v_master_a_id, v_ex_id, 0, 3, 10);

  -- 4. Find existing platform master (user_id IS NULL, is_master = true)
  SELECT id INTO v_platform_id
  FROM public.routine_templates
  WHERE is_master = true AND user_id IS NULL
  LIMIT 1;

  IF v_platform_id IS NULL THEN
    RAISE EXCEPTION 'Platform master template not found';
  END IF;

  SELECT id INTO v_platform_te_id
  FROM public.template_exercises
  WHERE template_id = v_platform_id
  LIMIT 1;

  IF v_platform_te_id IS NULL THEN
    RAISE EXCEPTION 'Platform template exercise not found';
  END IF;

  -- Switch to Coach B (authenticated)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_b || '"}', true);

  -- TEST 1: Coach B cannot update Coach A's master routine
  UPDATE public.routine_templates SET name = 'Modified by Coach B' WHERE id = v_master_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach B cannot update coach A master routine (saw % rows)', v_rows;
  END IF;

  -- TEST 2: Coach B cannot update exercises of Coach A's master routine
  UPDATE public.template_exercises SET target_sets = 99 WHERE id = v_te_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach B cannot update coach A master exercise (saw % rows)', v_rows;
  END IF;

  -- TEST 3: Coach B cannot delete exercises of Coach A's master routine
  DELETE FROM public.template_exercises WHERE id = v_te_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach B cannot delete coach A master exercise (saw % rows)', v_rows;
  END IF;

  -- TEST 4: Coach B cannot delete Coach A's master routine
  DELETE FROM public.routine_templates WHERE id = v_master_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach B cannot delete coach A master routine (saw % rows)', v_rows;
  END IF;

  -- TEST 5: Coach B cannot update platform master routine
  UPDATE public.routine_templates SET name = 'Modified Platform Master' WHERE id = v_platform_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach cannot update platform master routine (saw % rows)', v_rows;
  END IF;

  -- TEST 6: Coach B cannot update exercises of platform master routine
  UPDATE public.template_exercises SET target_sets = 99 WHERE id = v_platform_te_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach cannot update platform master exercise (saw % rows)', v_rows;
  END IF;

  -- TEST 7: Coach B cannot delete exercises of platform master routine
  DELETE FROM public.template_exercises WHERE id = v_platform_te_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach cannot delete platform master exercise (saw % rows)', v_rows;
  END IF;

  -- TEST 8: Coach B cannot delete platform master routine
  DELETE FROM public.routine_templates WHERE id = v_platform_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'coach cannot delete platform master routine (saw % rows)', v_rows;
  END IF;

  -- TEST 9: Document current save_routine_template RPC behavior on existing master routine
  -- Current behavior in 20261017000000_routine_templates_phase1.sql:296-302 allows coach role callers
  v_res := public.save_routine_template(
    p_template_id := v_master_rpc_id,
    p_name := 'Updated via RPC by Coach B',
    p_days_of_week := ARRAY['Tuesday']::text[],
    p_exercises := '[]'::jsonb
  );
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'save_routine_template RPC failed unexpectedly: %', v_res;
  END IF;

  -- Switch to Owner Coach A (authenticated)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_a || '"}', true);

  -- TEST 10: Owner Coach A CAN update own master routine
  UPDATE public.routine_templates SET name = 'Owner Updated Name' WHERE id = v_master_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'owner coach failed to update own master routine (saw % rows)', v_rows;
  END IF;

  -- TEST 11: Owner Coach A CAN update own master template exercise
  UPDATE public.template_exercises SET target_sets = 5 WHERE id = v_te_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'owner coach failed to update own master exercise (saw % rows)', v_rows;
  END IF;

  -- TEST 12: Owner Coach A CAN delete own master template exercise
  DELETE FROM public.template_exercises WHERE id = v_te_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'owner coach failed to delete own master exercise (saw % rows)', v_rows;
  END IF;

  -- TEST 13: Owner Coach A CAN delete own master routine
  DELETE FROM public.routine_templates WHERE id = v_master_a_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'owner coach failed to delete own master routine (saw % rows)', v_rows;
  END IF;

  -- Cleanup
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM auth.users WHERE id IN (v_coach_a, v_coach_b);
END;
$$;

SELECT pass('Coach B cannot update Coach A master routine');
SELECT pass('Coach B cannot update Coach A master exercise');
SELECT pass('Coach B cannot delete Coach A master exercise');
SELECT pass('Coach B cannot delete Coach A master routine');
SELECT pass('Coach cannot update platform master routine');
SELECT pass('Coach cannot update platform master exercise');
SELECT pass('Coach cannot delete platform master exercise');
SELECT pass('Coach cannot delete platform master routine');
SELECT pass('Current RPC behavior: save_routine_template permits coach caller on master template');
SELECT pass('Owner coach can update own master routine');
SELECT pass('Owner coach can update own master exercise');
SELECT pass('Owner coach can delete own master exercise');
SELECT pass('Owner coach can delete own master routine');

SELECT * FROM finish();
ROLLBACK;
