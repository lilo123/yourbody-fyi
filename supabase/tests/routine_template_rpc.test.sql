BEGIN;
SELECT plan(2);

-- 1. save_routine_template on a master template keeps is_master=true when p_is_master is omitted (L2)
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_tpl_id uuid := gen_random_uuid();
  v_res jsonb;
  v_is_master boolean;
BEGIN
  -- Create a platform coach user
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'rt_coach_l2@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;

  -- Create a pre-existing master routine template
  INSERT INTO public.routine_templates (id, user_id, name, is_master, days_of_week)
  VALUES (v_tpl_id, v_coach_id, 'Original Master Template', true, ARRAY['Monday']::text[]);

  -- Switch to platform coach role
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  -- Call save_routine_template WITHOUT passing p_is_master (simulates existing client call)
  v_res := public.save_routine_template(
    p_template_id := v_tpl_id,
    p_name := 'Updated Master Template',
    p_days_of_week := ARRAY['Monday', 'Wednesday']::text[],
    p_exercises := '[]'::jsonb
  );

  -- Verify is_master remained true
  SELECT is_master INTO v_is_master FROM public.routine_templates WHERE id = v_tpl_id;
  IF v_is_master IS NOT TRUE THEN
    RAISE EXCEPTION 'L2 regression: save_routine_template demoted master template to non-master (is_master is %)', v_is_master;
  END IF;

  -- Cleanup
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  DELETE FROM public.routine_templates WHERE id = v_tpl_id;
  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('save_routine_template on master template keeps is_master=true when p_is_master is omitted (L2)');

-- 2. An RPC error in save_routine_template rolls back completely and writes nothing
DO $$
DECLARE
  v_coach_id uuid := gen_random_uuid();
  v_count_before int;
  v_count_after int;
  v_err_caught boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_coach_id, 'rt_coach_err@test.com', '{"role":"coach"}'::jsonb);
  UPDATE public.users SET role = 'coach' WHERE id = v_coach_id;

  SELECT count(*) INTO v_count_before FROM public.routine_templates;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach_id || '"}', true);

  BEGIN
    -- Pass invalid exercise_id payload causing a cast error inside the RPC loop
    PERFORM public.save_routine_template(
      p_name := 'Atomic Test Routine',
      p_exercises := '[{"exercise_id":"invalid-uuid-format","target_sets":3,"target_reps":10}]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_caught := true;
  END;

  IF NOT v_err_caught THEN
    RAISE EXCEPTION 'Expected save_routine_template to fail on invalid exercise_id';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT count(*) INTO v_count_after FROM public.routine_templates;
  IF v_count_after <> v_count_before THEN
    RAISE EXCEPTION 'Atomic failure: routine_templates count changed after errored RPC (% -> %)', v_count_before, v_count_after;
  END IF;

  DELETE FROM auth.users WHERE id = v_coach_id;
END;
$$;
SELECT pass('save_routine_template rolls back atomically and writes nothing on error');

SELECT * FROM finish();
ROLLBACK;
