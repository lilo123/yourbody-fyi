BEGIN;
SELECT plan(10);

-- ============================================================================
-- 1. Schema Existence
-- ============================================================================
SELECT has_function('public', 'normalize_exercise_name', ARRAY['text'], 'normalize_exercise_name function exists');
SELECT has_index('public', 'exercises', 'idx_exercises_owner_norm_name_eq', 'partial unique index on exercises exists');
SELECT has_trigger('public', 'exercises', 'trg_exercise_name_guard', 'trg_exercise_name_guard trigger exists');

-- ============================================================================
-- 2. normalize_exercise_name Behavior
-- ============================================================================
SELECT is(
  public.normalize_exercise_name('   Bench    PRESS   '),
  'bench press',
  'normalize_exercise_name collapses spaces and lowercases'
);

-- ============================================================================
-- 3. Trigger & Duplicate Guard Tests
-- ============================================================================
DO $$
DECLARE
  v_user1 uuid := gen_random_uuid();
  v_user2 uuid := gen_random_uuid();
  v_master_bench_id uuid;
  v_err_sqlstate text;
  v_err_message text;
  v_err_detail text;
  v_inserted_id uuid;
BEGIN
  -- Create test users
  INSERT INTO auth.users (id, email) VALUES (v_user1, 'user1_guard@test.com'), (v_user2, 'user2_guard@test.com');

  -- Ensure master Bench Press exists with equipment = 'barbell'
  SELECT id INTO v_master_bench_id FROM public.exercises WHERE is_master = true AND name = 'Bench Press';
  IF v_master_bench_id IS NULL THEN
    INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
    VALUES ('Bench Press', ARRAY['Chest', 'Triceps']::text[], 'barbell', true, NULL)
    RETURNING id INTO v_master_bench_id;
  ELSE
    UPDATE public.exercises SET equipment = 'barbell', is_archived = false WHERE id = v_master_bench_id;
  END IF;

  -- Test A: 'BENCH PRESS' custom insert (NULL equipment) as authenticated user raises 23505 'duplicate_exercise_name'
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user1 || '"}', true);

  BEGIN
    INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
    VALUES ('BENCH PRESS', ARRAY['Chest']::text[], NULL, false, v_user1);
    RAISE EXCEPTION 'Test A failed: expected duplicate_exercise_name on custom NULL equipment vs master barbell';
  EXCEPTION WHEN sqlstate '23505' THEN
    GET STACKED DIAGNOSTICS
      v_err_sqlstate = RETURNED_SQLSTATE,
      v_err_message = MESSAGE_TEXT,
      v_err_detail = PG_EXCEPTION_DETAIL;
    IF v_err_message <> 'duplicate_exercise_name' THEN
      RAISE EXCEPTION 'Test A: expected message duplicate_exercise_name, got %', v_err_message;
    END IF;
    IF v_err_detail <> v_master_bench_id::text THEN
      RAISE EXCEPTION 'Test A: expected DETAIL %, got %', v_master_bench_id, v_err_detail;
    END IF;
  END;

  -- Test B: Custom insert with matching equipment 'barbell' raises 23505
  BEGIN
    INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
    VALUES ('Bench Press', ARRAY['Chest']::text[], 'barbell', false, v_user1);
    RAISE EXCEPTION 'Test B failed: expected duplicate_exercise_name on custom barbell vs master barbell';
  EXCEPTION WHEN sqlstate '23505' THEN
    GET STACKED DIAGNOSTICS v_err_message = MESSAGE_TEXT;
    IF v_err_message <> 'duplicate_exercise_name' THEN
      RAISE EXCEPTION 'Test B: expected message duplicate_exercise_name, got %', v_err_message;
    END IF;
  END;

  -- Test C: Different equipment allowed ('Bench Press' with equipment 'dumbbell')
  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('Bench Press', ARRAY['Chest']::text[], 'dumbbell', false, v_user1)
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RAISE EXCEPTION 'Test C failed: expected insert with dumbbell equipment to succeed';
  END IF;

  -- Test D: Case and whitespace insensitivity
  BEGIN
    INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
    VALUES ('   bEnCh     PrEsS  ', ARRAY['Chest']::text[], 'dumbbell', false, v_user1);
    RAISE EXCEPTION 'Test D failed: expected duplicate on same user with case/whitespace variations';
  EXCEPTION WHEN sqlstate '23505' THEN
    GET STACKED DIAGNOSTICS v_err_message = MESSAGE_TEXT;
    IF v_err_message <> 'duplicate_exercise_name' THEN
      RAISE EXCEPTION 'Test D: expected message duplicate_exercise_name, got %', v_err_message;
    END IF;
  END;

  -- Test E: Archived rows don't block
  -- Archive the dumbbell bench press
  UPDATE public.exercises SET is_archived = true WHERE id = v_inserted_id;

  -- Now inserting active 'Bench Press' with 'dumbbell' must succeed!
  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('Bench Press', ARRAY['Chest']::text[], 'dumbbell', false, v_user1);

  -- Test F: Inserting an archived row when an active row exists does not block
  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id, is_archived)
  VALUES ('Bench Press', ARRAY['Chest']::text[], 'dumbbell', false, v_user1, true);

  -- Reset credentials
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT pass('BENCH PRESS custom insert (NULL equipment) as authenticated user raises 23505 duplicate_exercise_name with master id detail');
SELECT pass('Custom insert with matching equipment raises 23505 duplicate_exercise_name');
SELECT pass('Different equipment (dumbbell vs barbell) is allowed');
SELECT pass('Duplicate guard is case and whitespace insensitive');
SELECT pass('Archived rows do not block active exercise creation with same name');
SELECT pass('Archived exercises can be inserted alongside active ones without collision');

SELECT * FROM finish();
ROLLBACK;
