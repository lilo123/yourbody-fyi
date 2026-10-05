-- Performance Benchmark Seed Script for Yourbody V2
-- User: bench-athlete@yourbody.fyi (05497a83-49a9-4802-aa84-0a81a2a53bf0)

-- 0. Ensure benchmark auth user, identity, and profile exist
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
  v_date date;
  v_timestamp timestamptz;
BEGIN
  -- Collect available exercise IDs
  SELECT array_agg(id) INTO v_exercise_ids FROM public.exercises;

  -- Clean existing data for benchmark user
  DELETE FROM public.sets WHERE workout_id IN (SELECT id FROM public.workouts WHERE user_id = v_user_id);
  DELETE FROM public.workouts WHERE user_id = v_user_id;
  DELETE FROM public.nutrition_logs WHERE user_id = v_user_id;

  -- 1. Generate 50 workouts and 11 sets per workout = 550 sets (within the last 90 days relative to current_date)
  FOR i IN 1..50 LOOP
    v_date := (current_date - (85 - (i * 1.7)::int));
    v_timestamp := (v_date::text || ' 09:30:00+00')::timestamptz;
    
    INSERT INTO public.workouts (id, user_id, name, date, created_at)
    VALUES (gen_random_uuid(), v_user_id, 'Workout Routine ' || (CASE WHEN (i % 2 = 0) THEN 'A' ELSE 'B' END), v_date, v_timestamp)
    RETURNING id INTO v_workout_id;

    FOR s IN 1..11 LOOP
      v_ex_id := v_exercise_ids[1 + ((s + i) % array_length(v_exercise_ids, 1))];
      INSERT INTO public.sets (id, workout_id, exercise_id, reps, weight, set_index, set_type, rpe, created_at)
      VALUES (
        gen_random_uuid(),
        v_workout_id,
        v_ex_id,
        8 + (s % 5),
        100 + (s * 10) + (i % 20),
        s,
        'working',
        8.0 + (s * 0.1),
        v_timestamp + (s * interval '3 minutes')
      );
    END LOOP;
  END LOOP;

  -- 2. Generate 350 nutrition logs across ~90 days relative to current_date
  FOR i IN 1..350 LOOP
    v_date := (current_date - (88 - (i / 4)::int));
    v_timestamp := (v_date::text || ' ' || LPAD((8 + (i % 4) * 4)::text, 2, '0') || ':00:00+00')::timestamptz;

    INSERT INTO public.nutrition_logs (
      id, user_id, food_name, calories, protein, carbs, fat, fiber, meal_type, logged_at, created_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      CASE (i % 5)
        WHEN 0 THEN 'Whey Protein & Oatmeal'
        WHEN 1 THEN 'Chicken Breast, Jasmine Rice & Broccoli'
        WHEN 2 THEN 'Greek Yogurt & Blueberries'
        WHEN 3 THEN 'Salmon Fillet, Sweet Potato & Asparagus'
        ELSE 'Grass-Fed Ground Beef & White Rice'
      END,
      350 + (i % 40) * 10,
      30 + (i % 25),
      40 + (i % 30),
      10 + (i % 15),
      5 + (i % 8),
      CASE (i % 4)
        WHEN 0 THEN 'breakfast'
        WHEN 1 THEN 'lunch'
        WHEN 2 THEN 'snack'
        ELSE 'dinner'
      END,
      v_timestamp,
      v_timestamp
    );
  END LOOP;

END $$;
