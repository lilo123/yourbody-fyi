-- Migration: 20260903000000_production_hardening.sql
-- Description: Hardens RLS, closes role elevation, eliminates dummy UUID backdoor,
--              adds exercise isolation, archive flag, template schedule days,
--              performance indexes, and check constraints.

-- 1. Helper Function: is_coach() with explicit search_path and no hardcoded UUIDs
CREATE OR REPLACE FUNCTION public.is_coach()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'coach'
    ) OR (
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->'app_metadata'->>'role' IN ('coach', 'admin')
    ),
    false
  );
$$;

-- 2. Auth Trigger: handle_new_user() with role sanitization and explicit search_path
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    username,
    role,
    target_calories,
    target_protein,
    target_carbs,
    target_fat,
    target_fiber
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    -- Security: Only trust service_role / app_metadata for 'coach' role; self-signups default to 'athlete'
    CASE
      WHEN NEW.raw_app_meta_data->>'role' = 'coach' THEN 'coach'
      ELSE 'athlete'
    END,
    2200,
    160,
    220,
    70,
    30
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    username = COALESCE(public.users.username, EXCLUDED.username);
  RETURN NEW;
END;
$$;

-- 3. Trigger: Prevent Client Role Mutations on public.users
CREATE OR REPLACE FUNCTION public.protect_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_claims text;
  v_jwt_role text;
BEGIN
  -- Strict rule: Client requests (anon or authenticated) cannot mutate role.
  -- Only service_role (admin API / edge functions) can update roles.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    v_jwt_claims := current_setting('request.jwt.claims', true);
    IF v_jwt_claims IS NOT NULL AND v_jwt_claims <> '' THEN
      BEGIN
        v_jwt_role := (v_jwt_claims::jsonb)->>'role';
      EXCEPTION WHEN OTHERS THEN
        v_jwt_role := NULL;
      END;
    END IF;

    IF current_user IN ('anon', 'authenticated') OR (v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role') THEN
      RAISE EXCEPTION 'Unauthorized: User role changes are restricted to administrative services.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_role ON public.users;
CREATE TRIGGER trg_protect_user_role
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_user_role_change();

-- 4. Schema Expansion: Exercise Isolation and Archival
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_master boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false NOT NULL;

-- Ensure all pre-existing catalog exercises are designated as master before RLS activates
UPDATE public.exercises
  SET is_master = true
  WHERE user_id IS NULL;

-- 5. Schema Expansion: Persist Template Schedule Days
ALTER TABLE public.routine_templates
  ADD COLUMN IF NOT EXISTS days_of_week text[] DEFAULT '{}';

-- 6. Performance B-Tree Indexes
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON public.workouts(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sets_workout_id ON public.sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise_id ON public.sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_user_logged ON public.nutrition_logs(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_routine_templates_user_assigned ON public.routine_templates(user_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_template_exercises_tpl ON public.template_exercises(template_id, order_index);
CREATE INDEX IF NOT EXISTS idx_custom_dishes_user ON public.custom_dishes(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_user_master ON public.exercises(is_master, user_id);

-- 7. Data Integrity Check Constraints
ALTER TABLE public.sets
  DROP CONSTRAINT IF EXISTS chk_sets_weight_non_negative,
  ADD CONSTRAINT chk_sets_weight_non_negative CHECK (weight >= 0),
  DROP CONSTRAINT IF EXISTS chk_sets_reps_non_negative,
  ADD CONSTRAINT chk_sets_reps_non_negative CHECK (reps >= 0),
  DROP CONSTRAINT IF EXISTS chk_sets_index_positive,
  ADD CONSTRAINT chk_sets_index_positive CHECK (set_index >= 1);

ALTER TABLE public.nutrition_logs
  DROP CONSTRAINT IF EXISTS chk_nutrition_calories_non_negative,
  ADD CONSTRAINT chk_nutrition_calories_non_negative CHECK (calories >= 0),
  DROP CONSTRAINT IF EXISTS chk_nutrition_protein_non_negative,
  ADD CONSTRAINT chk_nutrition_protein_non_negative CHECK (protein IS NULL OR protein >= 0),
  DROP CONSTRAINT IF EXISTS chk_nutrition_carbs_non_negative,
  ADD CONSTRAINT chk_nutrition_carbs_non_negative CHECK (carbs IS NULL OR carbs >= 0),
  DROP CONSTRAINT IF EXISTS chk_nutrition_fat_non_negative,
  ADD CONSTRAINT chk_nutrition_fat_non_negative CHECK (fat IS NULL OR fat >= 0),
  DROP CONSTRAINT IF EXISTS chk_nutrition_fiber_non_negative,
  ADD CONSTRAINT chk_nutrition_fiber_non_negative CHECK (fiber IS NULL OR fiber >= 0);

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS chk_users_targets_non_negative,
  ADD CONSTRAINT chk_users_targets_non_negative CHECK (
    (target_calories IS NULL OR target_calories >= 0) AND
    (target_protein IS NULL OR target_protein >= 0) AND
    (target_carbs IS NULL OR target_carbs >= 0) AND
    (target_fat IS NULL OR target_fat >= 0) AND
    (target_fiber IS NULL OR target_fiber >= 0)
  );

-- 8. Hardened RLS Policies for Exercises
DROP POLICY IF EXISTS "Anyone can read exercises" ON public.exercises;
DROP POLICY IF EXISTS "Authenticated users can insert exercises" ON public.exercises;
DROP POLICY IF EXISTS "Authenticated users can update exercises" ON public.exercises;
DROP POLICY IF EXISTS "Authenticated users can delete exercises" ON public.exercises;
DROP POLICY IF EXISTS "Exercises modifiable by coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises viewable by master, owner, or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises insertable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises modifiable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises deletable by owner or coach" ON public.exercises;

-- SELECT: Master exercises are visible to all; athletes view their own; coaches view all
CREATE POLICY "Exercises viewable by master, owner, or coach" ON public.exercises
  FOR SELECT
  USING (is_master = true OR user_id = auth.uid() OR public.is_coach());

-- INSERT: Athletes can only insert personal exercises; coaches can insert master or custom
CREATE POLICY "Exercises insertable by owner or coach" ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = user_id AND is_master = false)
    OR public.is_coach()
  );

-- UPDATE: Athletes can only modify their own non-master exercises; coaches can update any
CREATE POLICY "Exercises modifiable by owner or coach" ON public.exercises
  FOR UPDATE TO authenticated
  USING (
    (auth.uid() = user_id AND is_master = false)
    OR public.is_coach()
  )
  WITH CHECK (
    (auth.uid() = user_id AND is_master = false)
    OR public.is_coach()
  );

-- DELETE: Athletes can only delete their own non-master exercises; coaches can delete any
CREATE POLICY "Exercises deletable by owner or coach" ON public.exercises
  FOR DELETE TO authenticated
  USING (
    (auth.uid() = user_id AND is_master = false)
    OR public.is_coach()
  );
