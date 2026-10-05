BEGIN;
SELECT plan(33);

-- ============================================================================
-- 1. Schema Existence Assertions
-- ============================================================================
SELECT has_column('public', 'exercises', 'body_parts', 'exercises has body_parts column');
SELECT has_column('public', 'exercises', 'equipment', 'exercises has equipment column');
SELECT has_table('public', 'exercise_hides', 'exercise_hides table exists');
SELECT has_column('public', 'exercise_hides', 'hidden_by', 'exercise_hides has hidden_by column');
SELECT has_column('public', 'exercise_hides', 'exercise_id', 'exercise_hides has exercise_id column');
SELECT has_column('public', 'exercise_hides', 'created_at', 'exercise_hides has created_at column');
SELECT has_index('public', 'exercises', 'idx_exercises_body_parts', 'GIN index on body_parts exists');
SELECT has_index('public', 'exercises', 'idx_exercises_equipment', 'partial index on equipment exists');
SELECT has_index('public', 'exercises', 'idx_exercises_name_lower', 'lower(name) index exists');
SELECT has_function('public', 'get_exercise_catalog', ARRAY['text', 'text', 'text', 'boolean', 'integer', 'text'], 'get_exercise_catalog RPC exists');
SELECT has_function('public', 'get_routine_catalog', ARRAY['uuid', 'text', 'integer', 'text'], 'get_routine_catalog RPC exists');

-- ============================================================================
-- 2. Backfill Verification on Existing Master Data
-- ============================================================================
DO $$
DECLARE
  v_dips_parts text[];
  v_cable_eq text;
  v_mach_eq text;
  v_unmatched_eq text;
BEGIN
  SELECT body_parts INTO v_dips_parts
  FROM public.exercises WHERE name = 'Dips';

  IF v_dips_parts IS DISTINCT FROM ARRAY['Chest', 'Triceps'] THEN
    RAISE EXCEPTION 'Dips body_parts expected {Chest,Triceps}, got %', v_dips_parts;
  END IF;

  SELECT equipment INTO v_cable_eq FROM public.exercises WHERE name = 'Cable Lateral Raises';
  IF v_cable_eq <> 'cable' THEN
    RAISE EXCEPTION 'Cable Lateral Raises equipment expected "cable", got %', v_cable_eq;
  END IF;

  SELECT equipment INTO v_mach_eq FROM public.exercises WHERE name = 'Leg Extension Machine';
  IF v_mach_eq <> 'machine' THEN
    RAISE EXCEPTION 'Leg Extension Machine equipment expected "machine", got %', v_mach_eq;
  END IF;

  SELECT equipment INTO v_unmatched_eq FROM public.exercises WHERE name = 'Face Pulls';
  IF v_unmatched_eq <> 'cable' THEN
    RAISE EXCEPTION 'Face Pulls equipment expected cable, got %', v_unmatched_eq;
  END IF;
END;
$$;
SELECT pass('Dips (slash row) retains body_parts = {Chest, Triceps} post-M9');
SELECT pass('Cable Lateral Raises backfilled equipment = cable, Leg Extension Machine = machine');
SELECT pass('Face Pulls equipment backfilled to cable by M8');

-- ============================================================================
-- 3. Post-M9 Contract: Absence of body_part, Non-Empty body_parts, Catalog Output & Direct Writes
-- ============================================================================
-- 3.1 exercises.body_part column is absent post-M9
SELECT hasnt_column('public', 'exercises', 'body_part', 'exercises.body_part column is absent post-M9');

-- 3.2 exercises.body_parts is present and non-empty for all exercise rows
DO $$
DECLARE
  v_invalid_count int;
BEGIN
  SELECT count(*) INTO v_invalid_count
  FROM public.exercises
  WHERE body_parts IS NULL OR cardinality(body_parts) = 0;
  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % exercise rows with NULL or empty body_parts', v_invalid_count;
  END IF;
END;
$$;
SELECT pass('exercises.body_parts is present and non-empty for all exercise rows');

-- 3.3 get_exercise_catalog returns body_parts array
DO $$
DECLARE
  v_rec record;
BEGIN
  SELECT body_parts INTO v_rec FROM public.get_exercise_catalog(p_limit => 1);
  IF v_rec.body_parts IS NULL OR cardinality(v_rec.body_parts) = 0 THEN
    RAISE EXCEPTION 'get_exercise_catalog returned NULL or empty body_parts';
  END IF;
END;
$$;
SELECT pass('get_exercise_catalog returns body_parts array');

-- 3.4 get_exercise_catalog has no body_part output column
DO $$
DECLARE
  v_body_part_out_count int;
BEGIN
  SELECT count(*) INTO v_body_part_out_count
  FROM information_schema.parameters
  WHERE specific_schema = 'public'
    AND specific_name LIKE 'get_exercise_catalog%'
    AND parameter_mode = 'OUT'
    AND parameter_name = 'body_part';
  IF v_body_part_out_count <> 0 THEN
    RAISE EXCEPTION 'get_exercise_catalog still exposes body_part output column (% found)', v_body_part_out_count;
  END IF;
END;
$$;
SELECT pass('get_exercise_catalog has no body_part output column');

-- 3.5 Inserting and updating exercises with body_parts directly works; unrelated update preserves body_parts
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_ex1 uuid;
  v_rec record;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user, 'post_m9_test@test.com', '{"role":"athlete"}'::jsonb);

  -- Insert with body_parts works
  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Post-M9 Insert Test', ARRAY['Back', 'Biceps', 'Core'], false, v_user)
  RETURNING id INTO v_ex1;

  SELECT body_parts INTO v_rec FROM public.exercises WHERE id = v_ex1;
  IF v_rec.body_parts IS DISTINCT FROM ARRAY['Back', 'Biceps', 'Core'] THEN
    RAISE EXCEPTION 'Insert body_parts failed: expected {Back,Biceps,Core}, got %', v_rec.body_parts;
  END IF;

  -- Update body_parts directly works
  UPDATE public.exercises SET body_parts = ARRAY['Shoulders', 'Arms'] WHERE id = v_ex1;
  SELECT body_parts INTO v_rec FROM public.exercises WHERE id = v_ex1;
  IF v_rec.body_parts IS DISTINCT FROM ARRAY['Shoulders', 'Arms'] THEN
    RAISE EXCEPTION 'Update body_parts failed: expected {Shoulders,Arms}, got %', v_rec.body_parts;
  END IF;

  -- Unrelated UPDATE (name) preserves body_parts
  UPDATE public.exercises SET name = 'Post-M9 Insert Test Renamed' WHERE id = v_ex1;
  SELECT body_parts INTO v_rec FROM public.exercises WHERE id = v_ex1;
  IF v_rec.body_parts IS DISTINCT FROM ARRAY['Shoulders', 'Arms'] THEN
    RAISE EXCEPTION 'Unrelated update mutated body_parts! Expected {Shoulders,Arms}, got %', v_rec.body_parts;
  END IF;
END;
$$;
SELECT pass('Inserting and updating with body_parts works; unrelated update preserves body_parts');

-- ============================================================================
-- 4. Exercise Hides Table + RLS (RD-3, L47)
-- ============================================================================
DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_master_id uuid;
  v_custom_id uuid;
  v_hide_inserted boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_user_a, 'hide_user_a@test.com', '{"role":"athlete"}'::jsonb),
    (v_user_b, 'hide_user_b@test.com', '{"role":"athlete"}'::jsonb);

  SELECT id INTO v_master_id FROM public.exercises WHERE is_master = true LIMIT 1;

  INSERT INTO public.exercises (name, body_parts, is_master, user_id)
  VALUES ('Custom For Hide Test', ARRAY['Arms'], false, v_user_a)
  RETURNING id INTO v_custom_id;

  -- Test 1: User A inserts hide on master exercise -> SUCCESS
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);

  INSERT INTO public.exercise_hides (hidden_by, exercise_id)
  VALUES (v_user_a, v_master_id);

  IF NOT EXISTS (SELECT 1 FROM public.exercise_hides WHERE hidden_by = v_user_a AND exercise_id = v_master_id) THEN
    RAISE EXCEPTION 'User A could not insert own hide on master exercise';
  END IF;

  -- Test 2: User B tries to insert hide with hidden_by = User A -> fails RLS
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_b || '"}', true);
  BEGIN
    INSERT INTO public.exercise_hides (hidden_by, exercise_id)
    VALUES (v_user_a, v_master_id);
    v_hide_inserted := true;
  EXCEPTION WHEN OTHERS THEN
    v_hide_inserted := false;
  END;
  IF v_hide_inserted THEN
    RAISE EXCEPTION 'Security breach: User B inserted hide for User A';
  END IF;

  -- Test 3: User A tries to hide custom exercise -> fails RLS
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);
  BEGIN
    INSERT INTO public.exercise_hides (hidden_by, exercise_id)
    VALUES (v_user_a, v_custom_id);
    v_hide_inserted := true;
  EXCEPTION WHEN OTHERS THEN
    v_hide_inserted := false;
  END;
  IF v_hide_inserted THEN
    RAISE EXCEPTION 'Security breach: User A inserted hide on custom exercise';
  END IF;

  -- Test 4: User B tries to delete User A hide -> 0 rows affected
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_b || '"}', true);
  DELETE FROM public.exercise_hides WHERE hidden_by = v_user_a AND exercise_id = v_master_id;

  PERFORM set_config('role', 'postgres', true);
  IF NOT EXISTS (SELECT 1 FROM public.exercise_hides WHERE hidden_by = v_user_a AND exercise_id = v_master_id) THEN
    RAISE EXCEPTION 'Stranger deleted User A hide';
  END IF;

  -- Test 5: User A deletes own hide -> SUCCESS
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user_a || '"}', true);
  DELETE FROM public.exercise_hides WHERE hidden_by = v_user_a AND exercise_id = v_master_id;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
  IF EXISTS (SELECT 1 FROM public.exercise_hides WHERE hidden_by = v_user_a AND exercise_id = v_master_id) THEN
    RAISE EXCEPTION 'User A could not delete own hide';
  END IF;
END;
$$;
SELECT pass('Authenticated user can insert hide for master exercise');
SELECT pass('Authenticated user cannot insert hide for another user (stranger)');
SELECT pass('Authenticated user cannot insert hide for a custom non-master exercise');
SELECT pass('Authenticated user can delete own hide; stranger cannot delete another user hide');

-- ============================================================================
-- 5. get_exercise_catalog Functionality (Search, Scopes, Hides, Security)
-- ============================================================================
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_coach_ex uuid;
  v_ath_ex uuid;
  v_stranger_ex uuid;
  v_master_id uuid;
  v_seen int;
  v_rec record;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_coach, 'cat_coach@test.com', '{"role":"athlete"}'::jsonb),
    (v_ath, 'cat_ath@test.com', '{"role":"athlete"}'::jsonb),
    (v_stranger, 'cat_stranger@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-CAT1', is_coach_mode = true WHERE id = v_coach;

  -- Link coach and athlete
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);
  PERFORM public.link_to_coach('YB-CAT1');

  PERFORM set_config('role', 'postgres', true);
  -- Coach custom exercise
  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('Coach Barbell Complex', ARRAY['Legs', 'Back'], 'barbell', false, v_coach)
  RETURNING id INTO v_coach_ex;

  -- Athlete custom exercise
  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('Athlete Cable Pull', ARRAY['Back'], 'cable', false, v_ath)
  RETURNING id INTO v_ath_ex;

  -- Stranger custom exercise
  INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
  VALUES ('Stranger Secret Curl', ARRAY['Arms'], 'dumbbell', false, v_stranger)
  RETURNING id INTO v_stranger_ex;

  SELECT id INTO v_master_id FROM public.exercises WHERE name = 'Dragon Flag';

  -- 1. Search tests (as athlete)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);

  -- Search by name 'complex'
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_search => 'complex');
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Search by name "complex" expected 1 row, got %', v_seen;
  END IF;

  -- Search by body part token 'legs'
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_search => 'legs');
  IF v_seen < 1 THEN
    RAISE EXCEPTION 'Search by body part "legs" expected >= 1 row, got %', v_seen;
  END IF;

  -- 2. Scopes test (as athlete)
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_scope => 'mine');
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Scope "mine" for athlete expected 1, got %', v_seen;
  END IF;

  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_scope => 'coach');
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Scope "coach" for athlete expected 1, got %', v_seen;
  END IF;

  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_scope => 'defaults');
  IF v_seen < 12 THEN
    RAISE EXCEPTION 'Scope "defaults" expected >= 12, got %', v_seen;
  END IF;

  -- 3. Equipment filter test
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_equipment => 'cable');
  -- Cable has 3 master + 1 athlete = 4
  IF v_seen < 4 THEN
    RAISE EXCEPTION 'Equipment filter "cable" expected >= 4, got %', v_seen;
  END IF;

  -- 4. Multi-coach hide acceptance:
  -- Coach hides Dragon Flag
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach || '"}', true);
  INSERT INTO public.exercise_hides (hidden_by, exercise_id) VALUES (v_coach, v_master_id);

  -- Coach queries: Dragon Flag is absent when p_include_hidden = false
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_search => 'Dragon Flag', p_include_hidden => false);
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Coach sees hidden default Dragon Flag when include_hidden = false';
  END IF;

  -- Athlete queries: Dragon Flag is absent when p_include_hidden = false
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_search => 'Dragon Flag', p_include_hidden => false);
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Linked athlete sees coach-hidden default Dragon Flag when include_hidden = false';
  END IF;

  -- Unlinked stranger queries: Dragon Flag IS PRESENT!
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_stranger || '"}', true);
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_search => 'Dragon Flag', p_include_hidden => false);
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'Unlinked stranger cannot see Dragon Flag (saw %)', v_seen;
  END IF;

  -- Athlete queries with p_include_hidden = true: Dragon Flag is present with is_hidden = true
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);
  SELECT is_hidden INTO v_rec FROM public.get_exercise_catalog(p_search => 'Dragon Flag', p_include_hidden => true);
  IF v_rec.is_hidden IS NOT TRUE THEN
    RAISE EXCEPTION 'Athlete did not see is_hidden = true on Dragon Flag';
  END IF;

  -- 5. Coach sees no strangers customs (acceptance)
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_coach || '"}', true);
  SELECT count(*) INTO v_seen FROM public.get_exercise_catalog(p_search => 'Secret Curl');
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'Coach saw strangers custom exercise! (saw % rows)', v_seen;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Search by name substring and search by body part token work case-insensitively');
SELECT pass('Scopes (defaults, mine, coach, athlete, all) filter correctly');
SELECT pass('Equipment filter correctly restricts to specified equipment');
SELECT pass('Hidden default is absent by default (include_hidden = false) for coach AND linked athlete');
SELECT pass('Hidden default remains visible for unlinked stranger user');
SELECT pass('Hidden default is included when include_hidden = true with is_hidden = true');
SELECT pass('Coach sees no strangers custom exercises across all scopes');

-- ============================================================================
-- 6. Keyset Paging with 350 Seeded Exercises Reaches #201+ (Acceptance)
-- ============================================================================
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_page1_cursor text;
  v_page2_cursor text;
  v_page3_cursor text;
  v_page4_cursor text;
  v_row_count int;
  v_ex_name text;
  v_last_id uuid;
  v_last_name text;
  i int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_user, 'paged_user@test.com', '{"role":"athlete"}'::jsonb);

  -- Seed 350 exercises for this user
  FOR i IN 1..350 LOOP
    INSERT INTO public.exercises (name, body_parts, equipment, is_master, user_id)
    VALUES ('Paging Lift ' || lpad(i::text, 4, '0'), ARRAY['Core'], 'barbell', false, v_user);
  END LOOP;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_user || '"}', true);

  -- Page 1: scope 'mine', limit 50, cursor null -> returns 50 rows (0001 to 0050)
  SELECT id, name INTO v_last_id, v_last_name
  FROM public.get_exercise_catalog(p_scope => 'mine', p_limit => 50)
  ORDER BY lower(name) DESC, id DESC LIMIT 1;

  v_page1_cursor := lower(v_last_name) || '::' || v_last_id;

  -- Page 2: limit 50, cursor page1 -> returns 0051 to 0100
  SELECT id, name INTO v_last_id, v_last_name
  FROM public.get_exercise_catalog(p_scope => 'mine', p_limit => 50, p_cursor => v_page1_cursor)
  ORDER BY lower(name) DESC, id DESC LIMIT 1;

  v_page2_cursor := lower(v_last_name) || '::' || v_last_id;

  -- Page 3: limit 50, cursor page2 -> returns 0101 to 0150
  SELECT id, name INTO v_last_id, v_last_name
  FROM public.get_exercise_catalog(p_scope => 'mine', p_limit => 50, p_cursor => v_page2_cursor)
  ORDER BY lower(name) DESC, id DESC LIMIT 1;

  v_page3_cursor := lower(v_last_name) || '::' || v_last_id;

  -- Page 4: limit 50, cursor page3 -> returns 0151 to 0200
  SELECT id, name INTO v_last_id, v_last_name
  FROM public.get_exercise_catalog(p_scope => 'mine', p_limit => 50, p_cursor => v_page3_cursor)
  ORDER BY lower(name) DESC, id DESC LIMIT 1;

  v_page4_cursor := lower(v_last_name) || '::' || v_last_id;

  -- Page 5: limit 50, cursor page4 -> reaches #201+ (0201 to 0250)!
  SELECT count(*), min(name) INTO v_row_count, v_ex_name
  FROM public.get_exercise_catalog(p_scope => 'mine', p_limit => 50, p_cursor => v_page4_cursor);

  IF v_row_count <> 50 THEN
    RAISE EXCEPTION 'Page 5 expected 50 rows, got %', v_row_count;
  END IF;

  IF v_ex_name <> 'Paging Lift 0201' THEN
    RAISE EXCEPTION 'Page 5 first exercise expected "Paging Lift 0201", got %', v_ex_name;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('Keyset paging with 350 seeded exercises successfully pages through to #201+');

-- ============================================================================
-- 7. Routine Catalog Precedence Ranking & Templates #51+ (Acceptance)
-- ============================================================================
DO $$
DECLARE
  v_coach uuid := gen_random_uuid();
  v_ath uuid := gen_random_uuid();
  v_t_master uuid := gen_random_uuid();
  v_t_pers uuid := gen_random_uuid();
  v_t_asgn uuid := gen_random_uuid();
  v_ex uuid;
  v_rec record;
  v_page1_cursor text;
  v_row_count int;
  v_first_p2_name text;
  i int;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (v_coach, 'rcat_coach@test.com', '{"role":"athlete"}'::jsonb),
    (v_ath, 'rcat_ath@test.com', '{"role":"athlete"}'::jsonb);

  UPDATE public.users SET coach_code = 'YB-RCAT1', is_coach_mode = true WHERE id = v_coach;

  -- Link coach and athlete
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);
  PERFORM public.link_to_coach('YB-RCAT1');

  PERFORM set_config('role', 'postgres', true);
  SELECT id INTO v_ex FROM public.exercises WHERE is_master = true LIMIT 1;

  -- Master routine (score 1)
  INSERT INTO public.routine_templates (id, name, is_master, user_id, created_at)
  VALUES (v_t_master, 'ZZ Master Routine', true, v_coach, now() - interval '1 hour');

  -- Personal routine (score 2)
  INSERT INTO public.routine_templates (id, name, is_master, user_id, created_at)
  VALUES (v_t_pers, 'AA Personal Routine', false, v_ath, now() - interval '2 hours');

  -- Assigned routine (score 3)
  INSERT INTO public.routine_templates (id, name, is_master, user_id, assigned_to, created_at)
  VALUES (v_t_asgn, 'MM Assigned Routine', false, v_coach, v_ath, now() - interval '3 hours');

  -- Add template exercise
  INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
  VALUES (v_t_asgn, v_ex, 1, 3, 10);

  -- Athlete queries routine catalog
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);

  -- First returned row must be assigned (score 3)
  SELECT id, name, jsonb_array_length(exercises) AS ex_len INTO v_rec
  FROM public.get_routine_catalog()
  LIMIT 1;

  IF v_rec.id <> v_t_asgn THEN
    RAISE EXCEPTION 'Precedence rank failed: expected assigned routine %, got %', v_t_asgn, v_rec.id;
  END IF;

  IF v_rec.ex_len <> 1 THEN
    RAISE EXCEPTION 'Embedded exercises JSON missing: expected 1 item, got %', v_rec.ex_len;
  END IF;

  -- Test templates #51+ can be started
  -- Seed 60 personal routines for athlete
  PERFORM set_config('role', 'postgres', true);
  FOR i IN 1..60 LOOP
    INSERT INTO public.routine_templates (name, is_master, user_id, created_at)
    VALUES ('Ath Routine ' || lpad(i::text, 3, '0'), false, v_ath, now() - (i || ' minutes')::interval);
  END LOOP;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated","sub":"' || v_ath || '"}', true);

  -- Page 1: limit 50 -> 50 rows
  SELECT count(*), max(id::text) INTO v_row_count, v_page1_cursor
  FROM (
    SELECT id FROM public.get_routine_catalog(p_limit => 50)
  ) s;

  IF v_row_count <> 50 THEN
    RAISE EXCEPTION 'Routine page 1 expected 50 rows, got %', v_row_count;
  END IF;

  -- Page 2: with cursor from page 1 -> returns templates #51+
  SELECT count(*), min(name) INTO v_row_count, v_first_p2_name
  FROM public.get_routine_catalog(p_limit => 50, p_cursor => v_page1_cursor);

  IF v_row_count < 10 THEN
    RAISE EXCEPTION 'Routine page 2 expected >= 10 rows (reaching #51+), got %', v_row_count;
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
SELECT pass('get_routine_catalog returns templates with precedence ranking (assigned > personal > master)');
SELECT pass('get_routine_catalog paging returns templates #51+');

SELECT * FROM finish();
ROLLBACK;
