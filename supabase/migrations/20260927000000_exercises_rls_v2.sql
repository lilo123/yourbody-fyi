-- Migration 20260927000000_exercises_rls_v2.sql
-- M1: exercises RLS v2, FK restrict, name check constraint, save_routine_template L2 harden

-- 1. Tighten exercises RLS policies (W50, L1, RD-10)
DROP POLICY IF EXISTS "Exercises viewable by master, owner, or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises insertable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises insertable by owner" ON public.exercises;
DROP POLICY IF EXISTS "Exercises modifiable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises modifiable by owner" ON public.exercises;
DROP POLICY IF EXISTS "Exercises deletable by owner or coach" ON public.exercises;
DROP POLICY IF EXISTS "Exercises deletable by owner" ON public.exercises;

-- SELECT: Master exercises visible to all; own visible; linked counterparty visible (drops global is_coach())
CREATE POLICY "Exercises viewable by master, owner, or coach" ON public.exercises
  FOR SELECT
  USING (
    is_master = true
    OR user_id = auth.uid()
    OR public.is_coach_of(user_id)
    OR public.is_athlete_of(user_id)
  );

-- INSERT: Authenticated users can insert only personal non-master exercises
CREATE POLICY "Exercises insertable by owner" ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND is_master = false
  );

-- UPDATE: Authenticated users can update only their own non-master exercises; cannot flip is_master
CREATE POLICY "Exercises modifiable by owner" ON public.exercises
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    AND is_master = false
  )
  WITH CHECK (
    auth.uid() = user_id
    AND is_master = false
  );

-- DELETE: No policy created for authenticated (drop existing, preventing direct client hard-deletes)

-- 2. Foreign Key: template_exercises.exercise_id -> ON DELETE RESTRICT (L3)
ALTER TABLE public.template_exercises
  DROP CONSTRAINT IF EXISTS template_exercises_exercise_id_fkey,
  ADD CONSTRAINT template_exercises_exercise_id_fkey
    FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE RESTRICT;

-- 3. Non-blank name constraint on exercises (L12)
ALTER TABLE public.exercises
  DROP CONSTRAINT IF EXISTS chk_exercises_name_not_blank,
  ADD CONSTRAINT chk_exercises_name_not_blank
    CHECK (length(trim(name)) > 0);

-- 4. save_routine_template: preserve is_master via COALESCE on edit (L2)
CREATE OR REPLACE FUNCTION public.save_routine_template(
  p_template_id uuid DEFAULT NULL,
  p_name text DEFAULT '',
  p_days_of_week text[] DEFAULT NULL,
  p_exercises jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL,
  p_is_master boolean DEFAULT NULL,
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

  v_effective_is_master := (COALESCE(p_is_master, false) AND v_is_platform_coach);

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
        is_master = CASE WHEN v_is_platform_coach THEN COALESCE(p_is_master, is_master) ELSE is_master END,
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
