-- Migration: 20260906010000_atomic_template_update.sql
-- Description: Atomic template update RPC function with ownership and coach checks

CREATE OR REPLACE FUNCTION public.save_routine_template(
  p_template_id uuid,
  p_name text,
  p_days_of_week text[],
  p_exercises jsonb,
  p_user_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tpl_id uuid := p_template_id;
  v_target_user_id uuid;
  v_item jsonb;
  v_idx int := 0;
BEGIN
  -- Verify ownership or coach permissions
  IF v_tpl_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.routine_templates
      WHERE id = v_tpl_id AND (user_id = COALESCE(p_user_id, auth.uid()) OR user_id = auth.uid() OR public.is_coach())
    ) THEN
      RAISE EXCEPTION 'Unauthorized: You do not have permission to edit this template.';
    END IF;

    UPDATE public.routine_templates
    SET name = trim(p_name),
        days_of_week = p_days_of_week
    WHERE id = v_tpl_id;

    DELETE FROM public.template_exercises WHERE template_id = v_tpl_id;
  ELSE
    v_target_user_id := COALESCE(p_user_id, auth.uid());
    INSERT INTO public.routine_templates (user_id, name, days_of_week, is_master)
    VALUES (v_target_user_id, trim(p_name), p_days_of_week, false)
    RETURNING id INTO v_tpl_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_exercises)
  LOOP
    INSERT INTO public.template_exercises (
      template_id,
      exercise_id,
      order_index,
      target_sets,
      target_reps
    ) VALUES (
      v_tpl_id,
      (v_item->>'exercise_id')::uuid,
      v_idx,
      COALESCE((v_item->>'target_sets')::int, 3),
      COALESCE((v_item->>'target_reps')::int, 10)
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN v_tpl_id;
END;
$$;
