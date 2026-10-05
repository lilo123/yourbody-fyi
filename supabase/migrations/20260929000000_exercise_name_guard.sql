-- Migration: 20260929000000_exercise_name_guard.sql
-- Description: M7 exercise name guard and routine template precondition (D-P7b-1, D-P7b-2, L35, L43)
-- 1. routine_templates.updated_at + auto-update trigger
-- 2. save_routine_template upgrade with p_expected_updated_at and exercise visibility checks
-- 3. normalize_exercise_name immutable function
-- 4. Partial UNIQUE index idx_exercises_owner_norm_name_eq
-- 5. trg_exercise_name_guard trigger raising 23505 duplicate_exercise_name

-- 1. routine_templates.updated_at
ALTER TABLE public.routine_templates
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.trg_set_routine_templates_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_routine_templates_updated_at ON public.routine_templates;
CREATE TRIGGER set_routine_templates_updated_at
  BEFORE UPDATE ON public.routine_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_routine_templates_updated_at();

-- 2. save_routine_template (drop old 7-arg signature, create 8-arg signature)
DROP FUNCTION IF EXISTS public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION public.save_routine_template(
  p_template_id uuid DEFAULT NULL,
  p_name text DEFAULT '',
  p_days_of_week text[] DEFAULT NULL,
  p_exercises jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL,
  p_is_master boolean DEFAULT NULL,
  p_assigned_to uuid DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
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
  v_tpl_user_id uuid;
  v_tpl_is_master boolean;
  v_tpl_updated_at timestamptz;
  v_final_updated_at timestamptz;
  v_ex_id uuid;
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
    SELECT user_id, is_master, updated_at
    INTO v_tpl_user_id, v_tpl_is_master, v_tpl_updated_at
    FROM public.routine_templates
    WHERE id = v_tpl_id;

    IF NOT FOUND OR NOT (v_tpl_user_id = v_caller_id OR (v_is_platform_coach AND v_tpl_is_master = true)) THEN
      RAISE EXCEPTION 'Unauthorized: Template not found or permission denied.';
    END IF;

    IF p_expected_updated_at IS NOT NULL AND v_tpl_updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'stale_template' USING ERRCODE = 'PT409';
    END IF;

    UPDATE public.routine_templates
    SET name = trim(p_name),
        days_of_week = COALESCE(p_days_of_week, days_of_week),
        is_master = CASE WHEN v_is_platform_coach THEN COALESCE(p_is_master, is_master) ELSE is_master END,
        assigned_to = COALESCE(v_effective_assigned_to, assigned_to)
    WHERE id = v_tpl_id
    RETURNING updated_at INTO v_final_updated_at;

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
    RETURNING id, updated_at INTO v_tpl_id, v_final_updated_at;
  END IF;

  -- Validate exercise visibility and insert template_exercises
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_exercises)
  LOOP
    v_ex_id := (v_item->>'exercise_id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.exercises e
      WHERE e.id = v_ex_id
        AND (
          e.is_master = true
          OR e.user_id = v_caller_id
          OR public.is_coach_of(e.user_id)
          OR public.is_athlete_of(e.user_id)
        )
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Exercise not found or invisible to caller.'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.template_exercises (
      template_id, exercise_id, order_index, target_sets, target_reps
    ) VALUES (
      v_tpl_id,
      v_ex_id,
      v_idx,
      COALESCE((v_item->>'target_sets')::int, 3),
      COALESCE((v_item->>'target_reps')::int, 10)
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'template_id', v_tpl_id,
    'updated_at', v_final_updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz) TO authenticated, service_role;

-- 3. normalize_exercise_name immutable helper
CREATE OR REPLACE FUNCTION public.normalize_exercise_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(p_name, '')), '\s+', ' ', 'g'));
$$;

GRANT EXECUTE ON FUNCTION public.normalize_exercise_name(text) TO authenticated, anon, service_role;

-- 4. Partial UNIQUE index on owner, normalized name, equipment
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercises_owner_norm_name_eq
  ON public.exercises (
    COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    public.normalize_exercise_name(name),
    COALESCE(equipment, '')
  )
  WHERE (NOT is_archived);

-- 5. trg_exercise_name_guard trigger
CREATE OR REPLACE FUNCTION public.trg_exercise_name_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_norm_name text;
  v_existing_id uuid;
  v_is_master boolean;
BEGIN
  IF NEW.is_archived = true THEN
    RETURN NEW;
  END IF;

  v_norm_name := public.normalize_exercise_name(NEW.name);
  v_is_master := COALESCE(NEW.is_master, false);

  SELECT e.id INTO v_existing_id
  FROM public.exercises e
  WHERE e.is_archived = false
    AND e.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND public.normalize_exercise_name(e.name) = v_norm_name
    AND (e.equipment = NEW.equipment OR e.equipment IS NULL OR NEW.equipment IS NULL)
    AND (
      (v_is_master = true AND e.is_master = true)
      OR (v_is_master = false AND (e.is_master = true OR e.user_id = NEW.user_id))
    )
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_exercise_name'
      USING ERRCODE = '23505',
            DETAIL = v_existing_id::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exercise_name_guard ON public.exercises;
CREATE TRIGGER trg_exercise_name_guard
  BEFORE INSERT OR UPDATE OF name, equipment, is_archived
  ON public.exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_exercise_name_guard();

NOTIFY pgrst, 'reload schema';
