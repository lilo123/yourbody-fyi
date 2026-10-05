BEGIN;

-- 1. Extend public.users with coach attributes
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_coach_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS coach_code text,
  ADD COLUMN IF NOT EXISTS coach_tier text DEFAULT 'free' CHECK (coach_tier IN ('free', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS max_athletes integer DEFAULT 3;

CREATE UNIQUE INDEX IF NOT EXISTS users_coach_code_upper_idx 
  ON public.users (UPPER(coach_code)) 
  WHERE coach_code IS NOT NULL;

-- 2. Create coach_athlete_links junction table
CREATE TABLE IF NOT EXISTS public.coach_athlete_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  coach_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  athlete_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'disconnected')),
  linked_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  disconnected_at timestamp with time zone,
  CONSTRAINT no_self_coaching CHECK (coach_id <> athlete_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_coach_per_athlete 
  ON public.coach_athlete_links (athlete_id) 
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_coach_athlete_pair 
  ON public.coach_athlete_links (coach_id, athlete_id) 
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cal_coach_athlete_active 
  ON public.coach_athlete_links (coach_id, athlete_id) 
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_cal_athlete_active 
  ON public.coach_athlete_links (athlete_id) 
  WHERE status = 'active';

-- 3. Scoped Bidirectional Relationship Helpers
CREATE OR REPLACE FUNCTION public.is_coach_of(target_athlete_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_athlete_links
    WHERE coach_id = auth.uid() 
      AND athlete_id = target_athlete_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_athlete_of(target_coach_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_athlete_links
    WHERE coach_id = target_coach_id
      AND athlete_id = auth.uid()
      AND status = 'active'
  );
$$;

-- 4. Subscription Protection Trigger
CREATE OR REPLACE FUNCTION public.protect_user_subscription_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := (nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF (NEW.coach_tier IS DISTINCT FROM OLD.coach_tier OR NEW.max_athletes IS DISTINCT FROM OLD.max_athletes) THEN
    -- Allow default initial values ('free', 3) if transitioning from NULL
    IF (OLD.coach_tier IS NULL AND NEW.coach_tier = 'free') AND (OLD.max_athletes IS NULL AND NEW.max_athletes = 3) THEN
      RETURN NEW;
    END IF;

    IF current_user IN ('anon', 'authenticated') OR (v_jwt_role IS NOT NULL AND v_jwt_role <> 'service_role') THEN
      RAISE EXCEPTION 'Unauthorized: Subscription tiers and athlete quotas can only be modified by administrative payment webhooks.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_user_subscription_fields ON public.users;
CREATE TRIGGER trg_protect_user_subscription_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.protect_user_subscription_fields();

-- 5. RPC: link_to_coach
CREATE OR REPLACE FUNCTION public.link_to_coach(input_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_athlete_id uuid := auth.uid();
  v_coach_id uuid;
  v_coach_name text;
  v_max_athletes int;
  v_current_athletes int;
  v_clean_code text := UPPER(TRIM(input_code));
BEGIN
  IF v_athlete_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF v_clean_code IS NULL OR LENGTH(v_clean_code) < 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please enter a valid coach code.');
  END IF;

  SELECT id, username, max_athletes 
  INTO v_coach_id, v_coach_name, v_max_athletes
  FROM public.users
  WHERE UPPER(coach_code) = v_clean_code AND is_coach_mode = true
  FOR UPDATE;

  IF v_coach_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid or inactive coach code. Please verify with your coach.');
  END IF;

  IF v_coach_id = v_athlete_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot link to your own coach code.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.coach_athlete_links
    WHERE coach_id = v_coach_id AND athlete_id = v_athlete_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object(
      'success', true, 
      'coach', jsonb_build_object('id', v_coach_id, 'username', v_coach_name),
      'already_linked', true
    );
  END IF;

  SELECT COUNT(*) INTO v_current_athletes
  FROM public.coach_athlete_links
  WHERE coach_id = v_coach_id AND status = 'active';

  IF v_current_athletes >= COALESCE(v_max_athletes, 3) THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'This coach has reached their maximum athlete capacity (' || v_current_athletes || '/' || v_max_athletes || '). Ask your coach to upgrade their tier.'
    );
  END IF;

  UPDATE public.coach_athlete_links
  SET status = 'disconnected', disconnected_at = now()
  WHERE athlete_id = v_athlete_id AND status = 'active';

  INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
  VALUES (v_coach_id, v_athlete_id, 'active', now());

  RETURN jsonb_build_object(
    'success', true, 
    'coach', jsonb_build_object('id', v_coach_id, 'username', v_coach_name)
  );
END;
$$;

-- 6. RPC: disconnect_coach
CREATE OR REPLACE FUNCTION public.disconnect_coach(target_athlete_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  UPDATE public.coach_athlete_links
  SET status = 'disconnected', disconnected_at = now()
  WHERE status = 'active'
    AND (
      (athlete_id = v_user_id AND (target_athlete_id IS NULL OR target_athlete_id = v_user_id))
      OR
      (coach_id = v_user_id AND athlete_id = target_athlete_id)
    );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7. RPC: set_coach_code
CREATE OR REPLACE FUNCTION public.set_coach_code(custom_code text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_code text;
  v_existing_code text;
  v_tries int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT coach_code INTO v_existing_code FROM public.users WHERE id = auth.uid();

  IF custom_code IS NOT NULL AND TRIM(custom_code) <> '' THEN
    v_code := UPPER(TRIM(custom_code));
    IF NOT (v_code ~ '^[A-Z0-9_-]{4,20}$') THEN
      RAISE EXCEPTION 'Coach code must be 4-20 alphanumeric characters, hyphens, or underscores.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE UPPER(coach_code) = v_code AND id <> auth.uid()) THEN
      RAISE EXCEPTION 'This coach code is already in use. Please choose another.';
    END IF;
  ELSIF v_existing_code IS NOT NULL AND v_existing_code <> '' THEN
    v_code := v_existing_code;
  ELSE
    LOOP
      v_code := 'CYBER-' || UPPER(SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE UPPER(coach_code) = v_code) OR v_tries > 20;
      v_tries := v_tries + 1;
    END LOOP;
  END IF;

  UPDATE public.users 
  SET coach_code = v_code, 
      is_coach_mode = true,
      coach_tier = COALESCE(coach_tier, 'free'),
      max_athletes = COALESCE(max_athletes, 3)
  WHERE id = auth.uid();

  RETURN v_code;
END;
$$;

-- 8. RPC: update_athlete_macros
CREATE OR REPLACE FUNCTION public.update_athlete_macros(
  p_athlete_id uuid,
  p_calories numeric,
  p_protein numeric,
  p_carbs numeric,
  p_fat numeric,
  p_fiber numeric DEFAULT 30
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT public.is_coach_of(p_athlete_id) THEN
    RAISE EXCEPTION 'Unauthorized: You are not an active coach for this athlete.';
  END IF;

  IF p_calories < 0 OR p_protein < 0 OR p_carbs < 0 OR p_fat < 0 OR p_fiber < 0 THEN
    RAISE EXCEPTION 'Target macros must be non-negative.';
  END IF;

  UPDATE public.users
  SET target_calories = p_calories,
      target_protein = p_protein,
      target_carbs = p_carbs,
      target_fat = p_fat,
      target_fiber = p_fiber
  WHERE id = p_athlete_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. RPC: save_routine_template (Backward-Compatible & Protected)
DROP FUNCTION IF EXISTS public.save_routine_template(uuid, text, text[], jsonb, uuid);

CREATE OR REPLACE FUNCTION public.save_routine_template(
  p_template_id uuid DEFAULT NULL,
  p_name text DEFAULT '',
  p_days_of_week text[] DEFAULT NULL,
  p_exercises jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL,
  p_is_master boolean DEFAULT false,
  p_assigned_to uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_tpl_id uuid := p_template_id;
  v_item jsonb;
  v_idx int := 0;
  v_is_coach_mode boolean;
  v_is_platform_coach boolean;
  v_effective_assigned_to uuid;
  v_effective_is_master boolean;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT 
    COALESCE(role = 'coach' OR is_coach_mode = true, false),
    COALESCE(role = 'coach', false)
  INTO v_is_coach_mode, v_is_platform_coach
  FROM public.users WHERE id = v_caller_id;

  IF p_assigned_to IS NOT NULL THEN
    v_effective_assigned_to := p_assigned_to;
  ELSIF p_user_id IS NOT NULL AND p_user_id <> v_caller_id THEN
    v_effective_assigned_to := p_user_id;
  ELSE
    v_effective_assigned_to := NULL;
  END IF;

  IF v_effective_assigned_to IS NOT NULL AND v_effective_assigned_to <> v_caller_id THEN
    IF NOT (v_is_coach_mode AND public.is_coach_of(v_effective_assigned_to)) THEN
      RAISE EXCEPTION 'Unauthorized: You can only assign routines to your active linked athletes.';
    END IF;
  END IF;

  v_effective_is_master := (p_is_master AND v_is_platform_coach);

  IF v_tpl_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.routine_templates
      WHERE id = v_tpl_id AND (user_id = v_caller_id OR (v_is_platform_coach AND is_master = true))
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Template not found or permission denied.';
    END IF;

    UPDATE public.routine_templates
    SET name = trim(p_name),
        days_of_week = COALESCE(p_days_of_week, days_of_week),
        is_master = CASE WHEN v_is_platform_coach THEN p_is_master ELSE is_master END,
        assigned_to = COALESCE(v_effective_assigned_to, assigned_to)
    WHERE id = v_tpl_id;

    DELETE FROM public.template_exercises WHERE template_id = v_tpl_id;
  ELSE
    INSERT INTO public.routine_templates (
      user_id, name, days_of_week, is_master, assigned_to
    ) VALUES (
      v_caller_id,
      trim(p_name),
      p_days_of_week,
      v_effective_is_master,
      v_effective_assigned_to
    )
    RETURNING id INTO v_tpl_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_exercises)
  LOOP
    INSERT INTO public.template_exercises (
      template_id, exercise_id, order_index, target_sets, target_reps
    ) VALUES (
      v_tpl_id,
      (v_item->>'exercise_id')::uuid,
      v_idx,
      COALESCE((v_item->>'target_sets')::int, 3),
      COALESCE((v_item->>'target_reps')::int, 10)
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'template_id', v_tpl_id);
END;
$$;

-- 10. Scoped Row-Level Security Policies
ALTER TABLE public.coach_athlete_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own coaching links" ON public.coach_athlete_links
  FOR SELECT TO authenticated USING (coach_id = auth.uid() OR athlete_id = auth.uid());
CREATE POLICY "Deny direct client inserts" ON public.coach_athlete_links FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "Deny direct client updates" ON public.coach_athlete_links FOR UPDATE TO authenticated USING (false);
CREATE POLICY "Deny direct client deletes" ON public.coach_athlete_links FOR DELETE TO authenticated USING (false);

-- Users (Bidirectional Scoped Visibility, <=63 chars identifier)
DROP POLICY IF EXISTS "Users and coaches can view users" ON public.users;
DROP POLICY IF EXISTS "Users can update their own user record" ON public.users;
DROP POLICY IF EXISTS "Users can insert their own user record" ON public.users;
DROP POLICY IF EXISTS "Users and coaches view users bidirectional" ON public.users;
DROP POLICY IF EXISTS "Users update own profile only" ON public.users;
DROP POLICY IF EXISTS "Users insert own profile only" ON public.users;

CREATE POLICY "Users and coaches view users bidirectional" ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_coach_of(id) OR public.is_athlete_of(id));

CREATE POLICY "Users update own profile only" ON public.users
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Users insert own profile only" ON public.users
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Workouts
DROP POLICY IF EXISTS "Users and coaches can manage workouts" ON public.workouts;
DROP POLICY IF EXISTS "Users view own workouts or coaches view linked athletes" ON public.workouts;
DROP POLICY IF EXISTS "Users insert own workouts only" ON public.workouts;
DROP POLICY IF EXISTS "Users update own workouts only" ON public.workouts;
DROP POLICY IF EXISTS "Users delete own workouts only" ON public.workouts;

CREATE POLICY "Users view own workouts or coaches view linked athletes" ON public.workouts
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_coach_of(user_id));
CREATE POLICY "Users insert own workouts only" ON public.workouts FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own workouts only" ON public.workouts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own workouts only" ON public.workouts FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Sets
DROP POLICY IF EXISTS "Users and coaches can manage sets" ON public.sets;
DROP POLICY IF EXISTS "Users view own sets or coaches view linked athletes" ON public.sets;
DROP POLICY IF EXISTS "Users insert sets for own workouts only" ON public.sets;
DROP POLICY IF EXISTS "Users update sets for own workouts only" ON public.sets;
DROP POLICY IF EXISTS "Users delete sets for own workouts only" ON public.sets;

CREATE POLICY "Users view own sets or coaches view linked athletes" ON public.sets
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workouts WHERE workouts.id = sets.workout_id AND (workouts.user_id = auth.uid() OR public.is_coach_of(workouts.user_id)))
  );
CREATE POLICY "Users insert sets for own workouts only" ON public.sets
  FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid()));
CREATE POLICY "Users update sets for own workouts only" ON public.sets
  FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid()));
CREATE POLICY "Users delete sets for own workouts only" ON public.sets
  FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.workouts WHERE workouts.id = sets.workout_id AND workouts.user_id = auth.uid()));

-- Nutrition Logs
DROP POLICY IF EXISTS "Users and coaches can manage nutrition_logs" ON public.nutrition_logs;
DROP POLICY IF EXISTS "Users view own nutrition logs or coaches view linked athletes" ON public.nutrition_logs;
DROP POLICY IF EXISTS "Users insert own nutrition logs only" ON public.nutrition_logs;
DROP POLICY IF EXISTS "Users update own nutrition logs only" ON public.nutrition_logs;
DROP POLICY IF EXISTS "Users delete own nutrition logs only" ON public.nutrition_logs;

CREATE POLICY "Users view own nutrition logs or coaches view linked athletes" ON public.nutrition_logs
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_coach_of(user_id));
CREATE POLICY "Users insert own nutrition logs only" ON public.nutrition_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own nutrition logs only" ON public.nutrition_logs FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own nutrition logs only" ON public.nutrition_logs FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Custom Dishes
DROP POLICY IF EXISTS "Users and coaches can manage custom_dishes" ON public.custom_dishes;
DROP POLICY IF EXISTS "Users manage own custom dishes only" ON public.custom_dishes;

CREATE POLICY "Users manage own custom dishes only" ON public.custom_dishes FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Routine Templates & Template Exercises
DROP POLICY IF EXISTS "Users and coaches can view routine_templates" ON public.routine_templates;
DROP POLICY IF EXISTS "Users and coaches can manage routine_templates" ON public.routine_templates;
DROP POLICY IF EXISTS "Routine templates select policy" ON public.routine_templates;
DROP POLICY IF EXISTS "Routine templates insert policy" ON public.routine_templates;
DROP POLICY IF EXISTS "Routine templates update policy" ON public.routine_templates;
DROP POLICY IF EXISTS "Routine templates delete policy" ON public.routine_templates;

CREATE POLICY "Routine templates select policy" ON public.routine_templates FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR is_master = true OR assigned_to = auth.uid() OR (assigned_to IS NOT NULL AND public.is_coach_of(assigned_to))
);
CREATE POLICY "Routine templates insert policy" ON public.routine_templates FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid() AND (assigned_to IS NULL OR assigned_to = auth.uid() OR public.is_coach_of(assigned_to)) AND (is_master = false OR public.is_coach())
);
CREATE POLICY "Routine templates update policy" ON public.routine_templates FOR UPDATE TO authenticated USING (
  user_id = auth.uid() OR (is_master = true AND public.is_coach())
) WITH CHECK (
  (user_id = auth.uid() OR (is_master = true AND public.is_coach())) AND (assigned_to IS NULL OR assigned_to = auth.uid() OR public.is_coach_of(assigned_to))
);
CREATE POLICY "Routine templates delete policy" ON public.routine_templates FOR DELETE TO authenticated USING (
  user_id = auth.uid() OR (is_master = true AND public.is_coach())
);

DROP POLICY IF EXISTS "Template exercises select policy" ON public.template_exercises;
DROP POLICY IF EXISTS "Template exercises insert policy" ON public.template_exercises;
DROP POLICY IF EXISTS "Template exercises update policy" ON public.template_exercises;
DROP POLICY IF EXISTS "Template exercises delete policy" ON public.template_exercises;
DROP POLICY IF EXISTS "Users and coaches can view template_exercises" ON public.template_exercises;
DROP POLICY IF EXISTS "Users and coaches can manage template_exercises" ON public.template_exercises;

CREATE POLICY "Template exercises select policy" ON public.template_exercises FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_exercises.template_id AND (t.user_id = auth.uid() OR t.is_master = true OR t.assigned_to = auth.uid() OR (t.assigned_to IS NOT NULL AND public.is_coach_of(t.assigned_to))))
);
CREATE POLICY "Template exercises insert policy" ON public.template_exercises FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_exercises.template_id AND (t.user_id = auth.uid() OR (t.is_master = true AND public.is_coach())))
);
CREATE POLICY "Template exercises update policy" ON public.template_exercises FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_exercises.template_id AND (t.user_id = auth.uid() OR (t.is_master = true AND public.is_coach())))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_exercises.template_id AND (t.user_id = auth.uid() OR (t.is_master = true AND public.is_coach())))
);
CREATE POLICY "Template exercises delete policy" ON public.template_exercises FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.routine_templates t WHERE t.id = template_exercises.template_id AND (t.user_id = auth.uid() OR (t.is_master = true AND public.is_coach())))
);

-- Explicit function and table permissions
GRANT ALL ON TABLE public.coach_athlete_links TO authenticated;
GRANT ALL ON TABLE public.coach_athlete_links TO service_role;
GRANT EXECUTE ON FUNCTION public.is_coach_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_athlete_of(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_to_coach(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_coach(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_coach_code(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_athlete_macros(uuid, numeric, numeric, numeric, numeric, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid) TO authenticated, service_role;

-- ============================================================================
-- 11. IDEMPOTENT DATA BACKFILL
-- ============================================================================

-- A. Backfill Demo Coach in Local Development / CI
UPDATE public.users
SET is_coach_mode = true,
    coach_code = COALESCE(coach_code, 'CYBER-DEMO01'),
    coach_tier = COALESCE(coach_tier, 'free'),
    max_athletes = COALESCE(max_athletes, 3)
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- B. Backfill any other coaches
UPDATE public.users
SET is_coach_mode = true,
    coach_code = 'CYBER-' || UPPER(SUBSTRING(md5(id::text || 'cybergym') FROM 1 FOR 6)),
    coach_tier = COALESCE(coach_tier, 'free'),
    max_athletes = COALESCE(max_athletes, 3)
WHERE role = 'coach' AND coach_code IS NULL;

-- C. Link Demo Coach and Demo Athlete (Local/CI)
INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
SELECT 'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'active', now()
WHERE EXISTS (SELECT 1 FROM public.users WHERE id = 'a0000000-0000-0000-0000-000000000001')
  AND EXISTS (SELECT 1 FROM public.users WHERE id = 'a0000000-0000-0000-0000-000000000002')
ON CONFLICT (athlete_id) WHERE status = 'active' DO NOTHING;

-- D. Infer and link pre-existing relationships via routine template assignments
INSERT INTO public.coach_athlete_links (coach_id, athlete_id, status, linked_at)
SELECT DISTINCT t.user_id, t.assigned_to, 'active', now()
FROM public.routine_templates t
JOIN public.users c ON c.id = t.user_id AND (c.role = 'coach' OR c.is_coach_mode = true)
JOIN public.users a ON a.id = t.assigned_to AND a.role = 'athlete'
WHERE t.assigned_to IS NOT NULL 
  AND t.assigned_to <> t.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.coach_athlete_links l 
    WHERE l.athlete_id = t.assigned_to AND l.status = 'active'
  )
ON CONFLICT (athlete_id) WHERE status = 'active' DO NOTHING;

COMMIT;
