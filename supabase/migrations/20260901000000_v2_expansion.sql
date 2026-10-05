-- Phase 1 Migration: Schema Expansion, Trigger, and Coach RLS

-- 1. Alter public.users table with role and macro targets
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'athlete' CHECK (role IN ('coach', 'athlete')),
  ADD COLUMN IF NOT EXISTS target_calories numeric DEFAULT 2200,
  ADD COLUMN IF NOT EXISTS target_protein numeric DEFAULT 160,
  ADD COLUMN IF NOT EXISTS target_carbs numeric DEFAULT 220,
  ADD COLUMN IF NOT EXISTS target_fat numeric DEFAULT 70;

-- 2. Alter public.sets table
ALTER TABLE public.sets
  ADD COLUMN IF NOT EXISTS set_index integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS set_type text DEFAULT 'working' CHECK (set_type IN ('warmup', 'working', 'drop')),
  ADD COLUMN IF NOT EXISTS rpe numeric CHECK (rpe >= 1 AND rpe <= 10);

-- 3. Alter public.nutrition_logs table
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS fiber numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meal_type text DEFAULT 'meal',
  ADD COLUMN IF NOT EXISTS serving_size numeric DEFAULT 1,
  ADD COLUMN IF NOT EXISTS serving_unit text DEFAULT 'serving';

-- 4. Create routine_templates and template_exercises
CREATE TABLE IF NOT EXISTS public.routine_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  is_master boolean DEFAULT false,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.template_exercises (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid REFERENCES public.routine_templates(id) ON DELETE CASCADE NOT NULL,
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE CASCADE NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  target_sets integer NOT NULL DEFAULT 3,
  target_reps integer DEFAULT 10,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Helper Functions & Auth Trigger
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'coach'
  ) OR ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'coach')
    OR ((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.users (id, email, username, role, target_calories, target_protein, target_carbs, target_fat)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'athlete'),
    2200,
    160,
    220,
    70
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(public.users.username, EXCLUDED.username),
    role = COALESCE(public.users.role, EXCLUDED.role);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. Enable RLS on new tables
ALTER TABLE public.routine_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_exercises ENABLE ROW LEVEL SECURITY;

-- 7. Update / Drop & Recreate RLS Policies to accommodate Coaches and Athletes

-- Users policies
DROP POLICY IF EXISTS "Users can manage their own user record" ON public.users;
DROP POLICY IF EXISTS "Admins can do anything on users" ON public.users;

CREATE POLICY "Users and coaches can view users" ON public.users
  FOR SELECT USING (auth.uid() = id OR public.is_coach());

CREATE POLICY "Users can update their own user record" ON public.users
  FOR UPDATE USING (auth.uid() = id OR public.is_coach());

CREATE POLICY "Users can insert their own user record" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id OR public.is_coach());

-- Exercises policies
DROP POLICY IF EXISTS "Anyone can read exercises" ON public.exercises;
DROP POLICY IF EXISTS "Admins can do anything on exercises" ON public.exercises;

CREATE POLICY "Anyone can read exercises" ON public.exercises
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert exercises" ON public.exercises
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update exercises" ON public.exercises
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete exercises" ON public.exercises
  FOR DELETE USING (auth.role() = 'authenticated');

-- Workouts policies
DROP POLICY IF EXISTS "Users can manage their own workouts" ON public.workouts;
DROP POLICY IF EXISTS "Admins can do anything on workouts" ON public.workouts;

CREATE POLICY "Users and coaches can manage workouts" ON public.workouts
  FOR ALL USING (auth.uid() = user_id OR public.is_coach())
  WITH CHECK (auth.uid() = user_id OR public.is_coach());

-- Sets policies
DROP POLICY IF EXISTS "Users can manage sets for their workouts" ON public.sets;
DROP POLICY IF EXISTS "Admins can do anything on sets" ON public.sets;

CREATE POLICY "Users and coaches can manage sets" ON public.sets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.workouts
      WHERE workouts.id = sets.workout_id
      AND (workouts.user_id = auth.uid() OR public.is_coach())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workouts
      WHERE workouts.id = sets.workout_id
      AND (workouts.user_id = auth.uid() OR public.is_coach())
    )
  );

-- Nutrition logs policies
DROP POLICY IF EXISTS "Users can manage their own nutrition_logs" ON public.nutrition_logs;
DROP POLICY IF EXISTS "Admins can do anything on nutrition_logs" ON public.nutrition_logs;

CREATE POLICY "Users and coaches can manage nutrition_logs" ON public.nutrition_logs
  FOR ALL USING (auth.uid() = user_id OR public.is_coach())
  WITH CHECK (auth.uid() = user_id OR public.is_coach());

-- Custom dishes policies
DROP POLICY IF EXISTS "Users can manage their own custom_dishes" ON public.custom_dishes;
DROP POLICY IF EXISTS "Admins can do anything on custom_dishes" ON public.custom_dishes;

CREATE POLICY "Users and coaches can manage custom_dishes" ON public.custom_dishes
  FOR ALL USING (auth.uid() = user_id OR public.is_coach())
  WITH CHECK (auth.uid() = user_id OR public.is_coach());

-- Routine templates policies
CREATE POLICY "Users and coaches can view routine_templates" ON public.routine_templates
  FOR SELECT USING (
    auth.uid() = user_id 
    OR public.is_coach() 
    OR is_master = true 
    OR assigned_to = auth.uid()
  );

CREATE POLICY "Users and coaches can manage routine_templates" ON public.routine_templates
  FOR ALL USING (auth.uid() = user_id OR public.is_coach())
  WITH CHECK (auth.uid() = user_id OR public.is_coach());

-- Template exercises policies
CREATE POLICY "Users and coaches can view template_exercises" ON public.template_exercises
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.routine_templates
      WHERE routine_templates.id = template_exercises.template_id
      AND (
        routine_templates.user_id = auth.uid() 
        OR public.is_coach() 
        OR routine_templates.is_master = true 
        OR routine_templates.assigned_to = auth.uid()
      )
    )
  );

CREATE POLICY "Users and coaches can manage template_exercises" ON public.template_exercises
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.routine_templates
      WHERE routine_templates.id = template_exercises.template_id
      AND (routine_templates.user_id = auth.uid() OR public.is_coach())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.routine_templates
      WHERE routine_templates.id = template_exercises.template_id
      AND (routine_templates.user_id = auth.uid() OR public.is_coach())
    )
  );

-- 8. Seed default exercises
INSERT INTO public.exercises (name, body_part) VALUES
  ('Incline Bench Press', 'Chest'),
  ('Cable Lateral Raises', 'Shoulders'),
  ('Dips', 'Chest / Triceps'),
  ('Leg Extension Machine', 'Legs'),
  ('Overhead Tricep Cable Pull', 'Arms'),
  ('Leg Raise', 'Core'),
  ('Lat Pull Down', 'Back'),
  ('Seated Cable Row', 'Back'),
  ('Inclined Bicep Curl', 'Arms'),
  ('Leg Curl', 'Legs'),
  ('Face Pulls', 'Shoulders'),
  ('Weighted Sit-Up', 'Core')
ON CONFLICT DO NOTHING;
