-- Migration: 20261017000000_routine_templates_phase1.sql
-- Routine Templates Phase 1: Shared Library + Copy-on-Write

-- 1. Add source_template_id column and index to routine_templates
ALTER TABLE public.routine_templates
  ADD COLUMN IF NOT EXISTS source_template_id uuid NULL REFERENCES public.routine_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_routine_templates_source_template_id
  ON public.routine_templates(source_template_id);

-- 2. Create routine_template_hides table with RLS matching exercise_hides
CREATE TABLE IF NOT EXISTS public.routine_template_hides (
  hidden_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.routine_templates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT routine_template_hides_pkey PRIMARY KEY (hidden_by, template_id)
);

CREATE INDEX IF NOT EXISTS idx_routine_template_hides_template_id
  ON public.routine_template_hides(template_id);

ALTER TABLE public.routine_template_hides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "routine_template_hides_select" ON public.routine_template_hides;
CREATE POLICY "routine_template_hides_select"
  ON public.routine_template_hides
  FOR SELECT
  TO authenticated
  USING (
    hidden_by = auth.uid()
    OR public.is_coach_of(hidden_by)
    OR public.is_athlete_of(hidden_by)
  );

DROP POLICY IF EXISTS "routine_template_hides_insert" ON public.routine_template_hides;
CREATE POLICY "routine_template_hides_insert"
  ON public.routine_template_hides
  FOR INSERT
  TO authenticated
  WITH CHECK (
    hidden_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.routine_templates rt
      WHERE rt.id = template_id
        AND rt.is_master = true
    )
  );

DROP POLICY IF EXISTS "routine_template_hides_delete" ON public.routine_template_hides;
CREATE POLICY "routine_template_hides_delete"
  ON public.routine_template_hides
  FOR DELETE
  TO authenticated
  USING (
    hidden_by = auth.uid()
  );

GRANT ALL ON TABLE public.routine_template_hides TO authenticated;

-- 3. Upgrade get_routine_catalog RPC to exclude hidden and forked masters
CREATE OR REPLACE FUNCTION public.get_routine_catalog(
  p_user_id uuid DEFAULT auth.uid(),
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_cursor text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  is_master boolean,
  user_id uuid,
  assigned_to uuid,
  days_of_week text[],
  exercises jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_user uuid;
  v_limit int;
  v_search text;
  v_cur_score int := NULL;
  v_cur_created_at timestamptz := NULL;
  v_cur_id uuid := NULL;
  v_cursor_uuid uuid := NULL;
  v_decoded text;
BEGIN
  v_target_user := COALESCE(p_user_id, auth.uid());
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_search := NULLIF(trim(p_search), '');

  -- Keyset cursor resolution on (score, created_at, id)
  IF p_cursor IS NOT NULL AND length(trim(p_cursor)) > 0 THEN
    BEGIN
      v_decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      v_decoded := p_cursor;
    END;

    IF v_decoded ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_cursor_uuid := v_decoded::uuid;
    ELSIF position('::' in v_decoded) > 0 THEN
      -- Format: score::created_at_iso::id
      BEGIN
        v_cur_score := split_part(v_decoded, '::', 1)::int;
        v_cur_created_at := split_part(v_decoded, '::', 2)::timestamptz;
        v_cur_id := split_part(v_decoded, '::', 3)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_uuid := NULL;
      END;
    ELSE
      BEGIN
        v_cursor_uuid := trim(v_decoded)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_uuid := NULL;
      END;
    END IF;

    IF v_cursor_uuid IS NOT NULL THEN
      SELECT
        CASE
          WHEN r.assigned_to = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 3
          WHEN r.user_id = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 2
          WHEN r.is_master = true THEN 1
          ELSE 0
        END,
        r.created_at,
        r.id
      INTO v_cur_score, v_cur_created_at, v_cur_id
      FROM public.routine_templates r
      WHERE r.id = v_cursor_uuid;
    END IF;
  END IF;

  RETURN QUERY
  WITH scored_routines AS (
    SELECT
      r.id,
      r.name,
      COALESCE(r.is_master, false) AS is_master,
      r.user_id,
      r.assigned_to,
      r.days_of_week,
      r.created_at,
      CASE
        WHEN r.assigned_to = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 3
        WHEN r.user_id = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 2
        WHEN r.is_master = true THEN 1
        ELSE 0
      END AS precedence_score,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', te.id,
              'template_id', te.template_id,
              'exercise_id', te.exercise_id,
              'order_index', te.order_index,
              'target_sets', te.target_sets,
              'target_reps', te.target_reps,
              'exercise', jsonb_build_object('name', ex.name)
            )
            ORDER BY te.order_index ASC, te.created_at ASC, te.id ASC
          )
          FROM public.template_exercises te
          LEFT JOIN public.exercises ex ON ex.id = te.exercise_id
          WHERE te.template_id = r.id
        ),
        '[]'::jsonb
      ) AS exercises
    FROM public.routine_templates r
    WHERE
      -- Visibility filter: masters (unless hidden by caller or forked by caller), caller's own, assigned to caller/target, or coach of target
      (
        (
          r.is_master = true
          AND NOT EXISTS (
            SELECT 1 FROM public.routine_template_hides h
            WHERE h.template_id = r.id AND h.hidden_by = v_target_user
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.routine_templates rt
            WHERE rt.source_template_id = r.id AND rt.user_id = v_target_user
          )
        )
        OR r.user_id = v_target_user
        OR r.assigned_to = v_target_user
        OR (v_target_user = auth.uid() AND r.user_id = auth.uid())
      )
      -- Search filter
      AND (
        v_search IS NULL OR lower(r.name) LIKE '%' || lower(v_search) || '%'
      )
  ),
  total_metric AS (
    SELECT count(*)::bigint AS full_count FROM scored_routines
  ),
  paged AS (
    SELECT
      sr.id,
      sr.name,
      sr.is_master,
      sr.user_id,
      sr.assigned_to,
      sr.days_of_week,
      sr.exercises,
      sr.created_at,
      tm.full_count AS total_count
    FROM scored_routines sr
    CROSS JOIN total_metric tm
    WHERE
      (
        v_cur_score IS NULL
        OR (
          sr.precedence_score < v_cur_score
          OR (sr.precedence_score = v_cur_score AND sr.created_at < v_cur_created_at)
          OR (sr.precedence_score = v_cur_score AND sr.created_at = v_cur_created_at AND sr.id < v_cur_id)
        )
      )
    ORDER BY sr.precedence_score DESC, sr.created_at DESC, sr.id DESC
    LIMIT v_limit
  )
  SELECT * FROM paged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_routine_catalog(uuid, text, int, text) TO authenticated, anon;

-- 4. Upgrade save_routine_template with p_source_template_id and master update restriction
DROP FUNCTION IF EXISTS public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.save_routine_template(
  p_template_id uuid DEFAULT NULL,
  p_name text DEFAULT '',
  p_days_of_week text[] DEFAULT NULL,
  p_exercises jsonb DEFAULT '[]'::jsonb,
  p_user_id uuid DEFAULT NULL,
  p_is_master boolean DEFAULT NULL,
  p_assigned_to uuid DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_source_template_id uuid DEFAULT NULL
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

    IF v_tpl_is_master = true AND NOT v_is_platform_coach THEN
      RAISE EXCEPTION 'Unauthorized: Only platform coaches can update master templates.';
    END IF;

    IF p_expected_updated_at IS NOT NULL AND v_tpl_updated_at <> p_expected_updated_at THEN
      RAISE EXCEPTION 'stale_template' USING ERRCODE = 'PT409';
    END IF;

    UPDATE public.routine_templates
    SET name = trim(p_name),
        days_of_week = COALESCE(p_days_of_week, days_of_week),
        is_master = CASE WHEN v_is_platform_coach THEN COALESCE(p_is_master, is_master) ELSE is_master END,
        assigned_to = COALESCE(v_effective_assigned_to, assigned_to),
        source_template_id = COALESCE(p_source_template_id, source_template_id)
    WHERE id = v_tpl_id
    RETURNING updated_at INTO v_final_updated_at;

    DELETE FROM public.template_exercises WHERE template_id = v_tpl_id;
  ELSE
    INSERT INTO public.routine_templates (
      user_id, name, days_of_week, is_master, assigned_to, source_template_id
    ) VALUES (
      v_caller_id,
      trim(p_name),
      p_days_of_week,
      v_effective_is_master,
      v_effective_assigned_to,
      p_source_template_id
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

GRANT EXECUTE ON FUNCTION public.save_routine_template(uuid, text, text[], jsonb, uuid, boolean, uuid, timestamptz, uuid) TO authenticated, service_role;

-- 5. get_hidden_routine_templates RPC for caller/athlete hidden masters
CREATE OR REPLACE FUNCTION public.get_hidden_routine_templates(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  name text,
  is_master boolean,
  user_id uuid,
  assigned_to uuid,
  days_of_week text[],
  exercises jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_user uuid;
BEGIN
  v_target_user := COALESCE(p_user_id, auth.uid());

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    COALESCE(r.is_master, false) AS is_master,
    r.user_id,
    r.assigned_to,
    r.days_of_week,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', te.id,
            'template_id', te.template_id,
            'exercise_id', te.exercise_id,
            'order_index', te.order_index,
            'target_sets', te.target_sets,
            'target_reps', te.target_reps,
            'exercise', jsonb_build_object('name', ex.name)
          )
          ORDER BY te.order_index ASC, te.created_at ASC, te.id ASC
        )
        FROM public.template_exercises te
        LEFT JOIN public.exercises ex ON ex.id = te.exercise_id
        WHERE te.template_id = r.id
      ),
      '[]'::jsonb
    ) AS exercises,
    r.created_at
  FROM public.routine_templates r
  JOIN public.routine_template_hides h ON h.template_id = r.id
  WHERE h.hidden_by = v_target_user
    AND r.is_master = true
  ORDER BY r.name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_hidden_routine_templates(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
