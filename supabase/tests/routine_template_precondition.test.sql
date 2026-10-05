BEGIN;
SELECT plan(8);

-- ============================================================================
-- 1. Schema Existence
-- ============================================================================
SELECT has_column('public', 'routine_templates', 'updated_at', 'routine_templates has updated_at column');
SELECT col_not_null('public', 'routine_templates', 'updated_at', 'routine_templates.updated_at is NOT NULL');
SELECT has_function(
  'public',
  'save_routine_template',
  ARRAY['uuid', 'text', 'text[]', 'jsonb', 'uuid', 'boolean', 'uuid', 'timestamp with time zone'],
  'save_routine_template has 8-arg signature including p_expected_updated_at'
);

-- ============================================================================
-- 2. Behavioral Tests: Precondition and Visibility
-- ============================================================================
DO $$
DECLARE
  v_user1 uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();
  v_ex_master uuid;
  v_ex_user1 uuid;
  v_ex_user2 uuid;
  v_tpl_id uuid;
  v_res jsonb;
  v_initial_updated_at timestamptz;
  v_second_updated_at timestamptz;
  v_err_sqlstate text;
  v_err_message text;
BEGIN
  -- Create test users
  INSERT INTO auth.users (id, email) VALUES (v_user1, 'user1_rt@test.com'), (v_user2, 'user2_rt@test.com');

  -- Exercises: 1 master, 1 owned by user1, 1 private owned by user2
  SELECT id INTO v_ex_master FROM public.exercises WHERE is_master = true LIMIT 1;
  IF v_ex_master IS NULL THEN
    INSERT INTO public.exercises (name, body_parts, equipment, is_master)
    VALUES ('Precond Master', ARRAY['Chest']::text[], 'barbell', true)
    RETURNING id INTO v_ex_master;
  END IF;

  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('User1 Custom', ARRAY['Back']::text[], 'dumbbell', false, v_user1)
  RETURNING id INTO v_ex_user1;

  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('User2 Private', ARRAY['Legs']::text[], 'machine', false, v_user2)
  RETURNING id INTO v_ex_user2;

  -- Authenticate as user1
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user1 || '"}', true);

  -- Test A: Calling save_routine_template WITHOUT p_expected_updated_at succeeds and returns updated_at
  v_res := public.save_routine_template(
    p_name := 'User1 Routine A',
    p_days_of_week := ARRAY['Monday']::text[],
    p_exercises := jsonb_build_array(
      jsonb_build_object('exercise_id', v_ex_user1, 'target_sets', 3, 'target_reps', 10)
    )
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Test A failed: save_routine_template did not succeed';
  END IF;

  v_tpl_id := (v_res->>'template_id')::uuid;
  v_initial_updated_at := (v_res->>'updated_at')::timestamptz;

  IF v_initial_updated_at IS NULL THEN
    RAISE EXCEPTION 'Test A failed: updated_at was not returned in jsonb';
  END IF;

  -- Test B: Calling with matching p_expected_updated_at succeeds and updates updated_at
  -- Wait 5ms to guarantee timestamp advancement if clock resolution allows
  PERFORM pg_sleep(0.01);

  v_res := public.save_routine_template(
    p_template_id := v_tpl_id,
    p_name := 'User1 Routine A Updated',
    p_exercises := jsonb_build_array(
      jsonb_build_object('exercise_id', v_ex_master, 'target_sets', 4, 'target_reps', 8)
    ),
    p_expected_updated_at := v_initial_updated_at
  );

  v_second_updated_at := (v_res->>'updated_at')::timestamptz;
  IF v_second_updated_at IS NULL OR v_second_updated_at < v_initial_updated_at THEN
    RAISE EXCEPTION 'Test B failed: expected updated_at to be >= initial (% vs %)', v_second_updated_at, v_initial_updated_at;
  END IF;

  -- Test C: Calling with STALE p_expected_updated_at raises PT409 'stale_template'
  BEGIN
    PERFORM public.save_routine_template(
      p_template_id := v_tpl_id,
      p_name := 'User1 Routine A Stale Edit',
      p_exercises := '[]'::jsonb,
      p_expected_updated_at := v_initial_updated_at - interval '1 hour'
    );
    RAISE EXCEPTION 'Test C failed: expected PT409 stale_template exception';
  EXCEPTION WHEN sqlstate 'PT409' THEN
    GET STACKED DIAGNOSTICS v_err_message = MESSAGE_TEXT;
    IF v_err_message <> 'stale_template' THEN
      RAISE EXCEPTION 'Test C: expected error message stale_template, got %', v_err_message;
    END IF;
  END;

  -- Test D: Unseen exercise id (user2 private exercise) raises 42501
  BEGIN
    PERFORM public.save_routine_template(
      p_template_id := v_tpl_id,
      p_name := 'User1 Sneaky Routine',
      p_exercises := jsonb_build_array(
        jsonb_build_object('exercise_id', v_ex_user2, 'target_sets', 3, 'target_reps', 10)
      )
    );
    RAISE EXCEPTION 'Test D failed: expected 42501 when referencing unseen exercise';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL; -- Expected
  END;

  -- Test E: Random nonexistent UUID raises 42501
  BEGIN
    PERFORM public.save_routine_template(
      p_template_id := v_tpl_id,
      p_name := 'User1 Nonexistent Routine',
      p_exercises := jsonb_build_array(
        jsonb_build_object('exercise_id', gen_random_uuid(), 'target_sets', 3, 'target_reps', 10)
      )
    );
    RAISE EXCEPTION 'Test E failed: expected 42501 when referencing nonexistent exercise';
  EXCEPTION WHEN sqlstate '42501' THEN
    NULL; -- Expected
  END;

  -- Reset credentials
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT pass('save_routine_template without p_expected_updated_at succeeds and returns updated_at in jsonb');
SELECT pass('save_routine_template with matching p_expected_updated_at succeeds');
SELECT pass('stale save_routine_template raises PT409 stale_template');
SELECT pass('save_routine_template referencing unseen exercise raises 42501');
SELECT pass('save_routine_template referencing nonexistent exercise raises 42501');

SELECT * FROM finish();
ROLLBACK;
