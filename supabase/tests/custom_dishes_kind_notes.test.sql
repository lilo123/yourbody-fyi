BEGIN;
SELECT plan(20);

-- 1. Table & Column existence and schema assertions
SELECT has_column('public', 'custom_dishes', 'kind', 'custom_dishes has kind column');
SELECT col_type_is('public', 'custom_dishes', 'kind', 'text', 'custom_dishes.kind is text');
SELECT col_not_null('public', 'custom_dishes', 'kind', 'custom_dishes.kind is NOT NULL');
SELECT col_default_is('public', 'custom_dishes', 'kind', 'food', 'custom_dishes.kind default is food');

SELECT has_column('public', 'custom_dishes', 'use_count', 'custom_dishes has use_count column');
SELECT col_type_is('public', 'custom_dishes', 'use_count', 'integer', 'custom_dishes.use_count is integer');
SELECT col_not_null('public', 'custom_dishes', 'use_count', 'custom_dishes.use_count is NOT NULL');
SELECT col_default_is('public', 'custom_dishes', 'use_count', '0', 'custom_dishes.use_count default is 0');

SELECT has_column('public', 'custom_dishes', 'notes', 'custom_dishes has notes column');
SELECT col_type_is('public', 'custom_dishes', 'notes', 'text', 'custom_dishes.notes is text');
SELECT col_is_null('public', 'custom_dishes', 'notes', 'custom_dishes.notes is nullable');

SELECT has_column('public', 'nutrition_logs', 'notes', 'nutrition_logs has notes column');
SELECT col_type_is('public', 'nutrition_logs', 'notes', 'text', 'nutrition_logs.notes is text');
SELECT col_is_null('public', 'nutrition_logs', 'notes', 'nutrition_logs.notes is nullable');

-- 2. kind CHECK constraint: accepts ('food', 'recipe'), rejects any other value
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_dish_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'kind_chk_test@example.com', '{"role":"athlete"}'::jsonb);

  -- Valid: 'food'
  INSERT INTO public.custom_dishes (user_id, name, kind)
  VALUES (v_uid, 'Test Food Dish', 'food')
  RETURNING id INTO v_dish_id;

  -- Valid: 'recipe'
  UPDATE public.custom_dishes SET kind = 'recipe' WHERE id = v_dish_id;

  -- Invalid: 'snack' (must throw check_violation)
  BEGIN
    UPDATE public.custom_dishes SET kind = 'snack' WHERE id = v_dish_id;
    RAISE EXCEPTION 'CHECK constraint failed to reject kind = snack!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid INSERT: 'beverage'
  BEGIN
    INSERT INTO public.custom_dishes (user_id, name, kind)
    VALUES (v_uid, 'Test Beverage Dish', 'beverage');
    RAISE EXCEPTION 'CHECK constraint failed to reject kind = beverage!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.custom_dishes WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('custom_dishes.kind rejects values outside (food, recipe)');

-- 3. use_count CHECK constraint: rejects negative values, accepts >= 0
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_dish_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'use_count_chk_test@example.com', '{"role":"athlete"}'::jsonb);

  -- Valid: default 0
  INSERT INTO public.custom_dishes (user_id, name)
  VALUES (v_uid, 'Default Count Dish')
  RETURNING id INTO v_dish_id;

  -- Valid: positive count 5
  UPDATE public.custom_dishes SET use_count = 5 WHERE id = v_dish_id;

  -- Invalid: negative count -1 on UPDATE
  BEGIN
    UPDATE public.custom_dishes SET use_count = -1 WHERE id = v_dish_id;
    RAISE EXCEPTION 'CHECK constraint failed to reject use_count = -1!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: negative count on INSERT
  BEGIN
    INSERT INTO public.custom_dishes (user_id, name, use_count)
    VALUES (v_uid, 'Negative Count Dish', -10);
    RAISE EXCEPTION 'CHECK constraint failed to reject use_count = -10 on insert!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.custom_dishes WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('custom_dishes.use_count rejects negative values');

-- 4. custom_dishes.notes CHECK constraint: accepts 500 chars, rejects 501 chars, accepts NULL
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_dish_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'cd_notes_chk_test@example.com', '{"role":"athlete"}'::jsonb);

  -- Valid: exactly 500 characters
  INSERT INTO public.custom_dishes (user_id, name, notes)
  VALUES (v_uid, '500 char note dish', repeat('a', 500))
  RETURNING id INTO v_dish_id;

  -- Valid: NULL
  UPDATE public.custom_dishes SET notes = NULL WHERE id = v_dish_id;

  -- Invalid: 501 characters on UPDATE
  BEGIN
    UPDATE public.custom_dishes SET notes = repeat('a', 501) WHERE id = v_dish_id;
    RAISE EXCEPTION 'CHECK constraint failed to reject custom_dishes 501-character note on update!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: 501 characters on INSERT
  BEGIN
    INSERT INTO public.custom_dishes (user_id, name, notes)
    VALUES (v_uid, '501 char note dish', repeat('x', 501));
    RAISE EXCEPTION 'CHECK constraint failed to reject custom_dishes 501-character note on insert!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.custom_dishes WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('custom_dishes.notes rejects 501 chars and accepts 500 chars or NULL');

-- 5. nutrition_logs.notes CHECK constraint: accepts 500 chars, rejects 501 chars, accepts NULL
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_log_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'nl_notes_chk_test@example.com', '{"role":"athlete"}'::jsonb);

  -- Valid: exactly 500 characters
  INSERT INTO public.nutrition_logs (user_id, food_name, calories, notes)
  VALUES (v_uid, '500 char note log', 200, repeat('b', 500))
  RETURNING id INTO v_log_id;

  -- Valid: NULL
  UPDATE public.nutrition_logs SET notes = NULL WHERE id = v_log_id;

  -- Invalid: 501 characters on UPDATE
  BEGIN
    UPDATE public.nutrition_logs SET notes = repeat('b', 501) WHERE id = v_log_id;
    RAISE EXCEPTION 'CHECK constraint failed to reject nutrition_logs 501-character note on update!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  -- Invalid: 501 characters on INSERT
  BEGIN
    INSERT INTO public.nutrition_logs (user_id, food_name, calories, notes)
    VALUES (v_uid, '501 char note log', 200, repeat('y', 501));
    RAISE EXCEPTION 'CHECK constraint failed to reject nutrition_logs 501-character note on insert!';
  EXCEPTION WHEN check_violation THEN
    -- Expected
  END;

  DELETE FROM public.nutrition_logs WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('nutrition_logs.notes rejects 501 chars and accepts 500 chars or NULL');

-- 6. Backfill Verification with Explicit Fixtures
-- Proves that backfill logic produces:
-- - 'recipe' for a >1-item dish
-- - 'food' for a 1-item dish
-- - 'food' for a NULL-items dish (crucial: jsonb_array_length(NULL) is NULL, not 0)
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_dish_multi uuid;
  v_dish_single uuid;
  v_dish_null uuid;
  v_kind_multi text;
  v_kind_single text;
  v_kind_null text;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_uid, 'backfill_fixture@example.com', '{"role":"athlete"}'::jsonb);

  -- Fixture 1: Multi-item dish (2 components). Initially set kind = 'food'
  INSERT INTO public.custom_dishes (
    user_id, name, calories, protein, carbs, fat, fiber,
    items, kind
  ) VALUES (
    v_uid, 'Multi Component Recipe Fixture', 300, 20, 30, 10, 2,
    '[{"id":"i1","name":"Comp 1","calories":150,"protein":10,"carbs":15,"fat":5,"fiber":1,"quantity":100,"unit":"g"},
      {"id":"i2","name":"Comp 2","calories":150,"protein":10,"carbs":15,"fat":5,"fiber":1,"quantity":100,"unit":"g"}]'::jsonb,
    'food'
  ) RETURNING id INTO v_dish_multi;

  -- Fixture 2: Single-item dish (1 component). Initially set kind = 'recipe'
  INSERT INTO public.custom_dishes (
    user_id, name, calories, protein, carbs, fat, fiber,
    items, kind
  ) VALUES (
    v_uid, 'Single Component Food Fixture', 150, 10, 15, 5, 1,
    '[{"id":"i1","name":"Comp 1","calories":150,"protein":10,"carbs":15,"fat":5,"fiber":1,"quantity":100,"unit":"g"}]'::jsonb,
    'recipe'
  ) RETURNING id INTO v_dish_single;

  -- Fixture 3: NULL items dish (leaf / unitemized food). Initially set kind = 'recipe'
  INSERT INTO public.custom_dishes (
    user_id, name, calories, protein, carbs, fat, fiber,
    items, kind
  ) VALUES (
    v_uid, 'NULL Items Food Fixture', 150, 10, 15, 5, 1,
    NULL,
    'recipe'
  ) RETURNING id INTO v_dish_null;

  -- Execute the exact migration backfill statement on these fixtures
  UPDATE public.custom_dishes
  SET kind = CASE
    WHEN items IS NOT NULL
     AND jsonb_typeof(items) = 'array'
     AND jsonb_array_length(items) > 1
    THEN 'recipe'
    ELSE 'food'
  END
  WHERE user_id = v_uid;

  SELECT kind INTO v_kind_multi FROM public.custom_dishes WHERE id = v_dish_multi;
  SELECT kind INTO v_kind_single FROM public.custom_dishes WHERE id = v_dish_single;
  SELECT kind INTO v_kind_null FROM public.custom_dishes WHERE id = v_dish_null;

  IF v_kind_multi <> 'recipe' THEN
    RAISE EXCEPTION 'Backfill failed: multi-item dish expected recipe, got %', v_kind_multi;
  END IF;

  IF v_kind_single <> 'food' THEN
    RAISE EXCEPTION 'Backfill failed: single-item dish expected food, got %', v_kind_single;
  END IF;

  IF v_kind_null <> 'food' THEN
    RAISE EXCEPTION 'Backfill failed: null-items dish expected food, got %', v_kind_null;
  END IF;

  DELETE FROM public.custom_dishes WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;
SELECT pass('backfill correctly sets recipe for >1 items, food for 1 item, and food for NULL items');

-- 8. RLS still restricts custom_dishes to the owning user after ALTER
DO $$
DECLARE
  v_athlete_a uuid := gen_random_uuid();
  v_athlete_b uuid := gen_random_uuid();
  v_dish_a uuid;
  v_seen_count int;
  v_del_count int;
  v_upd_count int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_a, 'dish_rls_a@test.com', '{"role":"athlete"}'::jsonb);
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_athlete_b, 'dish_rls_b@test.com', '{"role":"athlete"}'::jsonb);

  -- Insert dish as athlete A
  INSERT INTO public.custom_dishes (user_id, name, kind, use_count, notes)
  VALUES (v_athlete_a, 'Athlete A Secret Dish', 'recipe', 3, 'Top secret seasoning')
  RETURNING id INTO v_dish_a;

  -- Authenticate as Athlete B
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_b || '"}', true);

  -- 1. Athlete B cannot SELECT Athlete A dish
  SELECT count(*) INTO v_seen_count FROM public.custom_dishes WHERE id = v_dish_a;
  IF v_seen_count <> 0 THEN
    RAISE EXCEPTION 'RLS failure: Athlete B can view Athlete A custom dish!';
  END IF;

  -- 2. Athlete B cannot UPDATE Athlete A dish
  UPDATE public.custom_dishes SET notes = 'tampered' WHERE id = v_dish_a;
  GET DIAGNOSTICS v_upd_count = ROW_COUNT;
  IF v_upd_count > 0 THEN
    RAISE EXCEPTION 'RLS failure: Athlete B updated Athlete A custom dish!';
  END IF;

  -- 3. Athlete B cannot DELETE Athlete A dish
  DELETE FROM public.custom_dishes WHERE id = v_dish_a;
  GET DIAGNOSTICS v_del_count = ROW_COUNT;
  IF v_del_count > 0 THEN
    RAISE EXCEPTION 'RLS failure: Athlete B deleted Athlete A custom dish!';
  END IF;

  -- 4. Athlete B cannot INSERT a dish under Athlete A user_id
  BEGIN
    INSERT INTO public.custom_dishes (user_id, name, kind, notes)
    VALUES (v_athlete_a, 'Forged Dish', 'food', 'Impersonated');
    RAISE EXCEPTION 'RLS failure: Athlete B inserted dish with Athlete A user_id!';
  EXCEPTION WHEN OTHERS THEN
    -- Expected RLS WITH CHECK violation
  END;

  -- Authenticate as Athlete A
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_athlete_a || '"}', true);

  -- Athlete A can read and update their own dish
  SELECT count(*) INTO v_seen_count FROM public.custom_dishes WHERE id = v_dish_a;
  IF v_seen_count <> 1 THEN
    RAISE EXCEPTION 'RLS failure: Athlete A cannot view their own dish!';
  END IF;

  UPDATE public.custom_dishes SET use_count = use_count + 1 WHERE id = v_dish_a;
  GET DIAGNOSTICS v_upd_count = ROW_COUNT;
  IF v_upd_count <> 1 THEN
    RAISE EXCEPTION 'RLS failure: Athlete A failed to update own dish!';
  END IF;

  -- Reset role to postgres
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.custom_dishes WHERE id = v_dish_a;
  DELETE FROM auth.users WHERE id = v_athlete_a;
  DELETE FROM auth.users WHERE id = v_athlete_b;
END;
$$;
SELECT pass('RLS restricts custom_dishes read, update, delete, and cross-insert to owning user');

SELECT * FROM finish();
ROLLBACK;
