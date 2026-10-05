-- Rollback: 20260929000000_exercise_name_guard.down.sql
-- Restores pre-migration M7 state (D-P7b-1, D-P7b-2)

-- 1. Drop trigger and trigger function
DROP TRIGGER IF EXISTS trg_exercise_name_guard ON public.exercises;
DROP FUNCTION IF EXISTS public.trg_exercise_name_guard();

-- 2. Drop partial unique index
DROP INDEX IF EXISTS public.idx_exercises_owner_norm_name_eq;

-- 3. Drop normalize_exercise_name function
DROP FUNCTION IF EXISTS public.normalize_exercise_name(text);

-- 4. Restore original save_routine_template (7 args)
DROP FUNCTION IF EXISTS public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz);

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

GRANT EXECUTE ON FUNCTION public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid) TO authenticated, service_role;

-- 5. Drop updated_at trigger and column
DROP TRIGGER IF EXISTS set_routine_templates_updated_at ON public.routine_templates;
DROP FUNCTION IF EXISTS public.trg_set_routine_templates_updated_at();
ALTER TABLE public.routine_templates DROP COLUMN IF EXISTS updated_at;

NOTIFY pgrst, 'reload schema';
