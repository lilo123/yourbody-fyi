-- Migration: 20261018100000_routine_templates_phase2.sql
-- Routine Templates Phase 2: Starter Routines, Reset to Original, Master Seed

-- 1. Allow nullable user_id on routine_templates for platform masters
ALTER TABLE public.routine_templates
  ALTER COLUMN user_id DROP NOT NULL;

-- 2. Drop and recreate get_routine_catalog RPC to return source_template_id
DROP FUNCTION IF EXISTS public.get_routine_catalog(uuid, text, int, text);

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
  total_count bigint,
  source_template_id uuid
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
      r.source_template_id,
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
      tm.full_count AS total_count,
      sr.source_template_id
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

-- 3. Idempotent INSERT-ONLY seed for platform master routines
-- Never updates, deletes, or alters existing masters or their exercises
DO $$
DECLARE
  v_tpl_id uuid;
  v_tpl_name text;
  v_days text[];
BEGIN
  FOR v_tpl_name, v_days IN VALUES
    ('Push, Quads, & Core - Reduced', ARRAY['Mon', 'Thu']::text[]),
    ('Pull, Hamstring, & Core - Reduced', ARRAY['Tue', 'Fri']::text[]),
    ('Workout A (Push, Quads & Core)', ARRAY[]::text[]),
    ('Workout B (Pull, Hamstrings & Core)', ARRAY[]::text[])
  LOOP
    -- 1. Check if a master template with this name already exists
    -- If it exists on staging/prod or from prior run, NEVER update, delete or replace it
    IF EXISTS (
      SELECT 1 FROM public.routine_templates
      WHERE is_master = true AND lower(trim(name)) = lower(trim(v_tpl_name))
    ) THEN
      CONTINUE;
    END IF;

    -- 2. New master: insert only with deterministic uuid
    v_tpl_id := md5('platform_master_routine:' || lower(trim(v_tpl_name)))::uuid;
    INSERT INTO public.routine_templates (id, user_id, name, is_master, assigned_to, days_of_week, created_at)
    VALUES (v_tpl_id, NULL, v_tpl_name, true, NULL, v_days, timezone('utc'::text, now()))
    ON CONFLICT (id) DO NOTHING;

    -- 3. Insert template exercises for the new master
    IF v_tpl_name = 'Push, Quads, & Core - Reduced' THEN
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      SELECT v_tpl_id, e.id, x.ord, x.sets, x.reps
      FROM (VALUES
        (0, 'Incline Bench Press', 4, 8),
        (1, 'Cable Lateral Raises', 3, 12),
        (2, 'Dips', 3, 10),
        (3, 'Leg Extension Machine', 3, 12),
        (4, 'Overhead Tricep Cable Pull', 3, 12)
      ) AS x(ord, ex_name, sets, reps)
      JOIN LATERAL (
        SELECT id FROM public.exercises e
        WHERE (e.is_master = true OR e.user_id IS NULL)
          AND lower(trim(e.name)) = lower(trim(x.ex_name))
        ORDER BY e.is_master DESC NULLS LAST, e.created_at ASC
        LIMIT 1
      ) e ON true;

    ELSIF v_tpl_name = 'Pull, Hamstring, & Core - Reduced' THEN
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      SELECT v_tpl_id, e.id, x.ord, x.sets, x.reps
      FROM (VALUES
        (0, 'Lat Pull Down', 4, 10),
        (1, 'Seated Cable Row', 3, 10),
        (2, 'Inclined Bicep Curl', 3, 12),
        (3, 'Leg Curl', 3, 12),
        (4, 'Face Pulls', 3, 15)
      ) AS x(ord, ex_name, sets, reps)
      JOIN LATERAL (
        SELECT id FROM public.exercises e
        WHERE (e.is_master = true OR e.user_id IS NULL)
          AND lower(trim(e.name)) = lower(trim(x.ex_name))
        ORDER BY e.is_master DESC NULLS LAST, e.created_at ASC
        LIMIT 1
      ) e ON true;

    ELSIF v_tpl_name = 'Workout A (Push, Quads & Core)' THEN
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      SELECT v_tpl_id, e.id, x.ord, x.sets, x.reps
      FROM (VALUES
        (0, 'Incline Bench Press', 4, 8),
        (1, 'Cable Lateral Raises', 3, 12),
        (2, 'Dips', 3, 10),
        (3, 'Leg Extension Machine', 3, 12),
        (4, 'Overhead Tricep Cable Pull', 3, 12),
        (5, 'Leg Raise', 3, 15)
      ) AS x(ord, ex_name, sets, reps)
      JOIN LATERAL (
        SELECT id FROM public.exercises e
        WHERE (e.is_master = true OR e.user_id IS NULL)
          AND lower(trim(e.name)) = lower(trim(x.ex_name))
        ORDER BY e.is_master DESC NULLS LAST, e.created_at ASC
        LIMIT 1
      ) e ON true;

    ELSIF v_tpl_name = 'Workout B (Pull, Hamstrings & Core)' THEN
      INSERT INTO public.template_exercises (template_id, exercise_id, order_index, target_sets, target_reps)
      SELECT v_tpl_id, e.id, x.ord, x.sets, x.reps
      FROM (VALUES
        (0, 'Lat Pull Down', 4, 10),
        (1, 'Seated Cable Row', 3, 10),
        (2, 'Inclined Bicep Curl', 3, 12),
        (3, 'Leg Curl', 3, 12),
        (4, 'Face Pulls', 3, 15),
        (5, 'Weighted Sit-Up', 3, 15)
      ) AS x(ord, ex_name, sets, reps)
      JOIN LATERAL (
        SELECT id FROM public.exercises e
        WHERE (e.is_master = true OR e.user_id IS NULL)
          AND lower(trim(e.name)) = lower(trim(x.ex_name))
        ORDER BY e.is_master DESC NULLS LAST, e.created_at ASC
        LIMIT 1
      ) e ON true;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
