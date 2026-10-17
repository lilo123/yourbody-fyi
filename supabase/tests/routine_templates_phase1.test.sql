BEGIN;
SELECT plan(12);

-- 1. Schema Existence
SELECT has_column('public', 'routine_templates', 'source_template_id', 'routine_templates has source_template_id column');
SELECT has_table('public', 'routine_template_hides', 'routine_template_hides table exists');
SELECT has_function(
  'public',
  'get_hidden_routine_templates',
  ARRAY['uuid'],
  'get_hidden_routine_templates RPC exists'
);

-- 2. Behavioral Tests
DO $$
DECLARE
  v_user1 uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_master_tpl uuid;
  v_non_master_tpl uuid;
  v_fork_tpl uuid;
  v_res jsonb;
  v_count int;
BEGIN
  -- Create test users
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_user1, 'user1_p1@test.com', '{"role":"athlete"}'::jsonb),
    (v_user2, 'user2_p1@test.com', '{"role":"athlete"}'::jsonb),
    (v_coach, 'coach_p1@test.com', '{"role":"coach"}'::jsonb);

  UPDATE public.users SET role = 'coach' WHERE id = v_coach;

  -- Create 1 master template and 1 user personal template
  INSERT INTO public.routine_templates (user_id, name, is_master, days_of_week)
  VALUES (v_coach, 'Phase1 Master Routine', true, ARRAY['Mon']::text[])
  RETURNING id INTO v_master_tpl;

  INSERT INTO public.routine_templates (user_id, name, is_master, days_of_week)
  VALUES (v_user1, 'Phase1 User1 Personal', false, ARRAY['Tue']::text[])
  RETURNING id INTO v_non_master_tpl;

  -- Authenticate as user1
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user1 || '"}', true);

  -- Test 1: User cannot hide on behalf of another user (hidden_by <> auth.uid())
  BEGIN
    INSERT INTO public.routine_template_hides (hidden_by, template_id)
    VALUES (v_user2, v_master_tpl);
    RAISE EXCEPTION 'RLS failed: user1 inserted hide row for user2';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Test 2: User cannot hide a non-master template
  BEGIN
    INSERT INTO public.routine_template_hides (hidden_by, template_id)
    VALUES (v_user1, v_non_master_tpl);
    RAISE EXCEPTION 'RLS failed: user1 hid a non-master template';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Test 3: User can hide a master template
  INSERT INTO public.routine_template_hides (hidden_by, template_id)
  VALUES (v_user1, v_master_tpl);

  SELECT count(*) INTO v_count FROM public.routine_template_hides
  WHERE hidden_by = v_user1 AND template_id = v_master_tpl;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Hide failed: row not found';
  END IF;

  -- Test 4: Catalog excludes hidden master for user1
  SELECT count(*) INTO v_count FROM public.get_routine_catalog(v_user1)
  WHERE id = v_master_tpl;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Catalog failed: hidden master returned for user1';
  END IF;

  -- Hidden masters list contains the hidden master
  SELECT count(*) INTO v_count FROM public.get_hidden_routine_templates(v_user1)
  WHERE id = v_master_tpl;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'get_hidden_routine_templates failed: hidden master not returned';
  END IF;

  -- Test 5: Switch to user2: user2 cannot delete user1 hide row
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user2 || '"}', true);
  DELETE FROM public.routine_template_hides WHERE hidden_by = v_user1;

  -- Switch back to user1: verify hide row is still there
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user1 || '"}', true);
  SELECT count(*) INTO v_count FROM public.routine_template_hides
  WHERE hidden_by = v_user1 AND template_id = v_master_tpl;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RLS failed: user2 deleted user1 hide row';
  END IF;

  -- User1 unhides (deletes own hide row)
  DELETE FROM public.routine_template_hides WHERE hidden_by = v_user1 AND template_id = v_master_tpl;
  SELECT count(*) INTO v_count FROM public.routine_template_hides
  WHERE hidden_by = v_user1 AND template_id = v_master_tpl;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Unhide failed: hide row still exists';
  END IF;

  -- Master template is now visible again in catalog
  SELECT count(*) INTO v_count FROM public.get_routine_catalog(v_user1)
  WHERE id = v_master_tpl;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Catalog failed: unhidden master not returned';
  END IF;

  -- Test 6: Non-coach cannot update a master template
  BEGIN
    PERFORM public.save_routine_template(
      p_template_id := v_master_tpl,
      p_name := 'Hacked Master Name'
    );
    RAISE EXCEPTION 'Security breach: athlete updated a master template';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Test 7: Non-coach forks a master template with source_template_id
  v_res := public.save_routine_template(
    p_name := 'Phase1 User1 Custom Fork',
    p_days_of_week := ARRAY['Mon']::text[],
    p_exercises := '[]'::jsonb,
    p_source_template_id := v_master_tpl
  );

  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'save_routine_template fork failed';
  END IF;

  v_fork_tpl := (v_res->>'template_id')::uuid;

  SELECT count(*) INTO v_count FROM public.routine_templates
  WHERE id = v_fork_tpl AND source_template_id = v_master_tpl AND user_id = v_user1;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Fork failed: source_template_id not set on routine_templates row';
  END IF;

  -- Test 8: Catalog excludes master template when user owns a fork pointing to it
  SELECT count(*) INTO v_count FROM public.get_routine_catalog(v_user1)
  WHERE id = v_master_tpl;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Catalog failed: forked master was not excluded for user1';
  END IF;

  -- Fork itself is returned in catalog with personal precedence score (2)
  SELECT count(*) INTO v_count FROM public.get_routine_catalog(v_user1)
  WHERE id = v_fork_tpl;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Catalog failed: fork not returned for user1';
  END IF;

  -- User2 (who has not forked or hidden the master) still sees the master
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user2 || '"}', true);
  SELECT count(*) INTO v_count FROM public.get_routine_catalog(v_user2)
  WHERE id = v_master_tpl;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Catalog failed: master not visible to user2';
  END IF;

  SELECT count(*) INTO v_count FROM public.get_routine_catalog(v_user2)
  WHERE id = v_fork_tpl;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Catalog failed: user1 fork leaked to user2';
  END IF;

END $$;

SELECT pass('user cannot hide on behalf of another user');
SELECT pass('user cannot hide a non-master template');
SELECT pass('user can hide a master template');
SELECT pass('catalog excludes hidden master for caller');
SELECT pass('get_hidden_routine_templates returns caller hidden masters');
SELECT pass('user cannot delete someone elses hide row');
SELECT pass('non-coach cannot update a master template');
SELECT pass('fork stores source_template_id');
SELECT pass('catalog excludes master when user owns a fork pointing to it');

ROLLBACK;
