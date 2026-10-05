-- Rollback 20260927000000_exercises_rls_v2.down.sql
-- Restores pre-migration M1 state for exercises RLS, FK action, name constraint, and save_routine_template

-- 1. Restore exercises RLS policies to pre-migration definitions
DROP POLICY IF EXISTS "Exercises viewable by master, owner, or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises insertable by owner" ON public.exercises;
DROP POLICY IF EXISTS "Exercises insertable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises modifiable by owner" ON public.exercises;
DROP POLICY IF EXISTS "Exercises modifiable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises deletable by owner" ON public.exercises;
DROP POLICY IF EXISTS "Exercises deletable by owner or coach" ON public.exercises;

-- SELECT (from 20260922010000_fix_exercises_rls_for_linked_coach_athlete.sql)
CREATE POLICY "Exercises viewable by master, owner, or coach" ON public.exercises
  FOR SELECT
  USING (
    is_master = true
    OR user_id = auth.uid()
    OR public.is_coach()
    OR public.is_coach_of(user_id)
    OR public.is_athlete_of(user_id)
  );

-- INSERT (from 20260903000000_production_hardening.sql)
CREATE POLICY "Exercises insertable by owner or coach" ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.uid() = user_id) AND (is_master = false))
    OR public.is_coach()
  );

-- UPDATE (from 20260903000000_production_hardening.sql)
CREATE POLICY "Exercises modifiable by owner or coach" ON public.exercises
  FOR UPDATE TO authenticated
  USING (
    ((auth.uid() = user_id) AND (is_master = false))
    OR public.is_coach()
  )
  WITH CHECK (
    ((auth.uid() = user_id) AND (is_master = false))
    OR public.is_coach()
  );

-- DELETE (from 20260903000000_production_hardening.sql)
CREATE POLICY "Exercises deletable by owner or coach" ON public.exercises
  FOR DELETE TO authenticated
  USING (
    ((auth.uid() = user_id) AND (is_master = false))
    OR public.is_coach()
  );

-- 2. Restore FK on template_exercises to ON DELETE CASCADE
ALTER TABLE public.template_exercises
  DROP CONSTRAINT IF EXISTS template_exercises_exercise_id_fkey,
  ADD CONSTRAINT template_exercises_exercise_id_fkey
    FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE CASCADE;

-- 3. Drop non-blank name constraint
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS chk_exercises_name_not_blank;

-- 4. Restore save_routine_template to previous body (from 20260909000000_multi_coach_code_linking.sql)
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
