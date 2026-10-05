-- Seed Demo Users in local development
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'coach@yourbody.fyi',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"],"role":"coach"}',
  '{"username":"Coach Demo","role":"coach"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
), (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'athlete@yourbody.fyi',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"],"role":"athlete"}',
  '{"username":"Alex Athlete","role":"athlete"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- Seed Demo Coach metadata and link to Demo Athlete
UPDATE public.users
SET is_coach_mode = true,
    coach_code = 'YB-DEMO01',
    coach_tier = 'free',
    max_athletes = 3
WHERE id = 'a0000000-0000-0000-0000-000000000001';

INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'active',
  now()
) ON CONFLICT (athlete_id) WHERE status = 'active' DO NOTHING;

-- Seed benchmark workout and sets for athlete (Alex Athlete) for ghost sets and history benchmarks
DO $$
DECLARE
  v_athlete_id uuid := 'a0000000-0000-0000-0000-000000000002';
  v_workout_id uuid := gen_random_uuid();
  v_incline_press_id uuid;
  v_timestamp timestamptz := (current_date - interval '3 days')::date + time '10:00:00';
BEGIN
  SELECT id INTO v_incline_press_id FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1;

  IF v_incline_press_id IS NOT NULL THEN
    INSERT INTO public.workouts (id, user_id, name, date, created_at)
    VALUES (
      v_workout_id,
      v_athlete_id,
      'Push Day Benchmark',
      v_timestamp,
      v_timestamp
    );

    INSERT INTO public.sets (id, workout_id, exercise_id, reps, weight, set_index, set_type, rpe, created_at)
    VALUES
      (gen_random_uuid(), v_workout_id, v_incline_press_id, 8, 185, 1, 'working', 8.5, v_timestamp + interval '2 minutes'),
      (gen_random_uuid(), v_workout_id, v_incline_press_id, 8, 185, 2, 'working', 9.0, v_timestamp + interval '5 minutes'),
      (gen_random_uuid(), v_workout_id, v_incline_press_id, 8, 185, 3, 'working', 9.5, v_timestamp + interval '8 minutes');
  END IF;
END $$;

-- Seed 75 routine_templates (with 2 template_exercises each) to verify bounded vs unbounded payload sizes (>51,200 B unbounded on /exercises vs <=51,200 B bounded limit=50 on /workout)
DO $$
DECLARE
  v_coach_id uuid := 'a0000000-0000-0000-0000-000000000001';
  v_athlete_id uuid := 'a0000000-0000-0000-0000-000000000002';
  v_ex1 uuid;
  v_ex2 uuid;
  v_tpl_id uuid;
  i integer;
BEGIN
  SELECT id INTO v_ex1 FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1;
  SELECT id INTO v_ex2 FROM public.exercises WHERE name = 'Cable Lateral Raises' LIMIT 1;

  IF v_ex1 IS NOT NULL AND v_ex2 IS NOT NULL THEN
    FOR i IN 1..75 LOOP
      v_tpl_id := gen_random_uuid();
      INSERT INTO public.routine_templates (id, user_id, name, is_master, assigned_to, created_at)
      VALUES (
        v_tpl_id,
        v_coach_id,
        format('Yourbody Master Hypertrophy Routine #%s', lpad(i::text, 3, '0')),
        true,
        v_athlete_id,
        now() - (i || ' minutes')::interval
      );

      INSERT INTO public.template_exercises (id, template_id, exercise_id, order_index, target_sets, target_reps)
      VALUES
        (gen_random_uuid(), v_tpl_id, v_ex1, 0, 3, 10),
        (gen_random_uuid(), v_tpl_id, v_ex2, 1, 3, 12);
    END LOOP;
  END IF;
END $$;

-- Dedicated User for Pagination E2E
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000009',
  'authenticated',
  'authenticated',
  'paginate@yourbody.fyi',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"],"role":"athlete"}',
  '{"username":"Paginate Athlete","role":"athlete"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'a0000000-0000-0000-0000-000000000009',
  'a0000000-0000-0000-0000-000000000009',
  '{"sub":"a0000000-0000-0000-0000-000000000009","email":"paginate@yourbody.fyi"}'::jsonb,
  'email',
  'a0000000-0000-0000-0000-000000000009',
  now(),
  now(),
  now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO public.users (id, email, username, role)
VALUES (
  'a0000000-0000-0000-0000-000000000009',
  'paginate@yourbody.fyi',
  'Paginate Athlete',
  'athlete'
) ON CONFLICT (id) DO NOTHING;

-- Seed exactly 151 workouts for paginate@yourbody.fyi with at least one set each
DO $$
DECLARE
  v_paginate_id uuid := 'a0000000-0000-0000-0000-000000000009';
  v_workout_id uuid;
  v_exercise_id uuid;
  v_time timestamptz;
  i integer;
BEGIN
  SELECT id INTO v_exercise_id FROM public.exercises WHERE name = 'Incline Bench Press' LIMIT 1;
  IF v_exercise_id IS NULL THEN
    SELECT id INTO v_exercise_id FROM public.exercises LIMIT 1;
  END IF;

  FOR i IN 1..151 LOOP
    v_workout_id := gen_random_uuid();
    v_time := now() - (i || ' days')::interval;

    INSERT INTO public.workouts (id, user_id, name, date, created_at)
    VALUES (
      v_workout_id,
      v_paginate_id,
      format('Paginate Workout %s', lpad(i::text, 3, '0')),
      v_time,
      v_time
    );

    INSERT INTO public.sets (id, workout_id, exercise_id, reps, weight, set_index, set_type, rpe, created_at)
    VALUES (
      gen_random_uuid(),
      v_workout_id,
      v_exercise_id,
      10,
      135 + (i % 50),
      1,
      'working',
      8.0,
      v_time + interval '2 minutes'
    );
  END LOOP;
END $$;




-- Payload Stress Benchmark Seed (wired from scripts/seed-payload-stress.sql)
-- User: bench-athlete@yourbody.fyi (05497a83-49a9-4802-aa84-0a81a2a53bf0)

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '05497a83-49a9-4802-aa84-0a81a2a53bf0',
  'authenticated',
  'authenticated',
  'bench-athlete@yourbody.fyi',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"],"role":"athlete"}',
  '{"username":"Bench Athlete","role":"athlete"}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  '05497a83-49a9-4802-aa84-0a81a2a53bf0',
  '05497a83-49a9-4802-aa84-0a81a2a53bf0',
  '{"sub":"05497a83-49a9-4802-aa84-0a81a2a53bf0","email":"bench-athlete@yourbody.fyi"}'::jsonb,
  'email',
  '05497a83-49a9-4802-aa84-0a81a2a53bf0',
  now(),
  now(),
  now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO public.users (id, email, username, role)
VALUES (
  '05497a83-49a9-4802-aa84-0a81a2a53bf0',
  'bench-athlete@yourbody.fyi',
  'Bench Athlete',
  'athlete'
) ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_user_id uuid := '05497a83-49a9-4802-aa84-0a81a2a53bf0';
  v_workout_id uuid;
  v_exercise_ids uuid[];
  v_ex_id uuid;
  i int;
  s int;
  d int;
  v_date date;
  v_timestamp timestamptz;
  v_payload text;
  v_items jsonb;
  v_cd_items jsonb;
BEGIN
  -- Collect available exercise IDs
  SELECT array_agg(id) INTO v_exercise_ids FROM public.exercises;

  -- Clean existing data for benchmark user (idempotent resets)
  DELETE FROM public.sets WHERE workout_id IN (SELECT id FROM public.workouts WHERE user_id = v_user_id);
  DELETE FROM public.workouts WHERE user_id = v_user_id;
  DELETE FROM public.nutrition_logs WHERE user_id = v_user_id;
  DELETE FROM public.custom_dishes WHERE user_id = v_user_id;

  -- 1. Create 50 workouts: Workout 50 has 500 sets; Workouts 1..49 have 2 sets each (total 598 sets >= 550)
  FOR i IN 1..50 LOOP
    v_date := (current_date - (50 - i));
    v_timestamp := (v_date::text || ' 09:30:00+00')::timestamptz;

    INSERT INTO public.workouts (id, user_id, name, date, created_at)
    VALUES (
      gen_random_uuid(),
      v_user_id,
      CASE WHEN i = 50 THEN 'Mega Stress Workout' ELSE 'Stress Routine ' || i END,
      v_date,
      v_timestamp
    )
    RETURNING id INTO v_workout_id;

    IF i = 50 THEN
      -- One workout with 500 sets
      FOR s IN 1..500 LOOP
        v_ex_id := v_exercise_ids[1 + (s % array_length(v_exercise_ids, 1))];
        INSERT INTO public.sets (id, workout_id, exercise_id, reps, weight, set_index, set_type, rpe, created_at)
        VALUES (
          gen_random_uuid(),
          v_workout_id,
          v_ex_id,
          8 + (s % 5),
          100 + (s % 100),
          s,
          'working',
          8.0,
          v_timestamp + (s * interval '1 minute')
        );
      END LOOP;
    ELSE
      -- Remaining 49 workouts with 2 sets each
      FOR s IN 1..2 LOOP
        v_ex_id := v_exercise_ids[1 + ((s + i) % array_length(v_exercise_ids, 1))];
        INSERT INTO public.sets (id, workout_id, exercise_id, reps, weight, set_index, set_type, rpe, created_at)
        VALUES (
          gen_random_uuid(),
          v_workout_id,
          v_ex_id,
          10,
          135,
          s,
          'working',
          8.0,
          v_timestamp + (s * interval '3 minutes')
        );
      END LOOP;
    END IF;
  END LOOP;

  -- 2. Generate 50 nutrition_logs each carrying >= 64 KB of items jsonb
  -- Precompute high-entropy payload (~67.2 KB uncompressed and uncompressible)
  SELECT string_agg(md5(j::text), '') INTO v_payload FROM generate_series(1, 2100) j;

  FOR i IN 1..50 LOOP
    v_date := (current_date - (50 - i));
    IF i = 50 THEN
      v_timestamp := now();
    ELSE
      v_timestamp := (v_date::text || ' ' || LPAD((8 + (i % 4) * 4)::text, 2, '0') || ':00:00+00')::timestamptz;
    END IF;

    IF i >= 46 THEN
      v_items := jsonb_build_array(
        jsonb_build_object(
          'id', 'stress-item-' || i || '-1',
          'name', 'Stress Food Item ' || i || ' A',
          'quantity', 1,
          'unit', 'serving',
          'calories', 60,
          'protein', 6,
          'carbs', 6,
          'fat', 1,
          'fiber', 1,
          'payload', v_payload
        ),
        jsonb_build_object(
          'id', 'stress-item-' || i || '-2',
          'name', 'Stress Food Item ' || i || ' B',
          'quantity', 1,
          'unit', 'serving',
          'calories', 40,
          'protein', 4,
          'carbs', 4,
          'fat', 1,
          'fiber', 0,
          'payload', v_payload
        )
      );
    ELSIF i <= 5 THEN
      v_items := NULL;
    ELSE
      v_items := jsonb_build_array(
        jsonb_build_object(
          'id', 'stress-item-' || i,
          'name', 'Stress Food Item ' || i,
          'quantity', 1,
          'unit', 'serving',
          'calories', 100,
          'protein', 10,
          'carbs', 10,
          'fat', 2,
          'fiber', 1,
          'payload', v_payload
        )
      );
    END IF;

    INSERT INTO public.nutrition_logs (
      id, user_id, food_name, calories, protein, carbs, fat, fiber, meal_type, logged_at, created_at, items
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      'Stress Meal ' || i,
      100,
      10,
      10,
      2,
      1,
      CASE (i % 4)
        WHEN 0 THEN 'breakfast'
        WHEN 1 THEN 'lunch'
        WHEN 2 THEN 'snack'
        ELSE 'dinner'
      END,
      v_timestamp,
      v_timestamp,
      v_items
    );
  END LOOP;

  -- 3. Generate custom_dishes with large items jsonb and large ingredients text
  FOR d IN 1..5 LOOP
    v_cd_items := jsonb_build_array(
      jsonb_build_object(
        'id', 'stress-cd-item-' || d,
        'name', 'Stress Custom Dish Item ' || d,
        'quantity', 1,
        'unit', 'serving',
        'calories', 500,
        'protein', 40,
        'carbs', 50,
        'fat', 15,
        'fiber', 5,
        'payload', v_payload
      )
    );

    INSERT INTO public.custom_dishes (
      id, user_id, name, ingredients, calories, protein, carbs, fat, fiber, items, created_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      'Stress Custom Dish ' || d,
      'Bulk meal prep ingredients: 200g chicken breast, 300g white rice, 100g steamed broccoli, 15ml olive oil. Large recipe notes: ' || v_payload,
      500,
      40,
      50,
      15,
      5,
      v_cd_items,
      now() - (d || ' hours')::interval
    );
  END LOOP;

END $$;
