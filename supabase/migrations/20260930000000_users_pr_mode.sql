-- Migration: 20260930000000_users_pr_mode.sql
-- Description: M10 add pr_mode preference to public.users table ('weight' | 'e1rm')
-- and update get_exercise_benchmarks and get_exercise_stats with trailing p_pr_mode parameter.
-- Expand-only, deploy-compatible: old frontend calls omitting p_pr_mode default to 'weight'
-- and receive identical ranking and semantics.
-- Decisions: D-P8.1-8, D-P8.1-9, D-P8.1-10, D-P8.1-11.

-- 1. Add pr_mode column to public.users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pr_mode text NOT NULL DEFAULT 'weight'
  CONSTRAINT users_pr_mode_check CHECK (pr_mode IN ('weight', 'e1rm'));

-- 2. Drop existing get_exercise_benchmarks overload so pg_proc remains unambiguous
DROP FUNCTION IF EXISTS public.get_exercise_benchmarks(uuid, date, uuid[]);

-- 3. Re-create get_exercise_benchmarks with trailing p_pr_mode parameter
CREATE OR REPLACE FUNCTION public.get_exercise_benchmarks(
  p_user_id uuid,
  p_date date,
  p_exercise_ids uuid[],
  p_pr_mode text DEFAULT 'weight'
)
RETURNS TABLE (
  exercise_id uuid,
  pr_weight numeric,
  pr_reps integer,
  pr_date date,
  pr_workout_id uuid,
  last_date date,
  last_workout_id uuid,
  last_sets jsonb,
  pr_e1rm numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_pr_mode NOT IN ('weight', 'e1rm') THEN
    RAISE EXCEPTION 'invalid_pr_mode: %', p_pr_mode USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH requested_exercises AS (
    SELECT UNNEST(p_exercise_ids) AS ex_id
  ),
  user_workouts AS (
    SELECT w.id, w.workout_date, w.created_at
    FROM public.workouts w
    WHERE w.user_id = p_user_id
  ),
  working_sets AS (
    SELECT
      s.id,
      s.workout_id,
      s.exercise_id,
      s.weight,
      s.reps,
      s.set_index,
      s.set_type,
      s.rpe,
      s.created_at,
      uw.workout_date,
      uw.created_at AS workout_created_at
    FROM public.sets s
    JOIN user_workouts uw ON uw.id = s.workout_id
    WHERE s.exercise_id = ANY(p_exercise_ids)
      AND COALESCE(s.set_type, 'working') NOT IN ('warmup', 'drop')
      AND s.weight IS NOT NULL
      AND s.reps IS NOT NULL
  ),
  pr_ranked AS (
    SELECT
      ws.exercise_id,
      ws.weight,
      ws.reps,
      ws.workout_date,
      ws.workout_id,
      ROW_NUMBER() OVER (
        PARTITION BY ws.exercise_id
        ORDER BY
          CASE
            WHEN p_pr_mode = 'e1rm' THEN
              CASE WHEN (ws.weight <= 0 OR ws.reps <= 12) THEN 1 ELSE 0 END
            ELSE 1
          END DESC,
          CASE
            WHEN p_pr_mode = 'e1rm' THEN
              CASE
                WHEN (ws.weight <= 0 OR ws.reps <= 12) THEN
                  CASE WHEN ws.weight <= 0 THEN 0.0 ELSE ROUND((ws.weight * (1.0 + ws.reps / 30.0))::numeric, 2) END
                ELSE ws.weight
              END
            ELSE ws.weight
          END DESC,
          ws.weight DESC,
          ws.reps DESC,
          ws.workout_date ASC,
          ws.created_at ASC,
          ws.id ASC
      ) AS rnk
    FROM working_sets ws
    WHERE ws.workout_date <= p_date
  ),
  pr_per_exercise AS (
    SELECT
      p.exercise_id,
      p.weight AS pr_weight,
      p.reps AS pr_reps,
      p.workout_date AS pr_date,
      p.workout_id AS pr_workout_id,
      CASE
        WHEN p_pr_mode = 'e1rm' THEN
          CASE
            WHEN p.weight <= 0 THEN 0.0
            ELSE ROUND((p.weight * (1.0 + p.reps / 30.0))::numeric, 2)
          END
        ELSE NULL
      END AS pr_e1rm
    FROM pr_ranked p
    WHERE p.rnk = 1
  ),
  prior_sessions_ranked AS (
    SELECT
      ws.exercise_id,
      ws.workout_id,
      ws.workout_date,
      ws.workout_created_at,
      DENSE_RANK() OVER (
        PARTITION BY ws.exercise_id
        ORDER BY ws.workout_date DESC, ws.workout_created_at DESC, ws.workout_id DESC
      ) AS session_rnk
    FROM working_sets ws
    WHERE ws.workout_date < p_date
  ),
  last_sessions AS (
    SELECT DISTINCT
      psr.exercise_id,
      psr.workout_id,
      psr.workout_date
    FROM prior_sessions_ranked psr
    WHERE psr.session_rnk = 1
  ),
  last_sets_agg AS (
    SELECT
      ls.exercise_id,
      ls.workout_date AS last_date,
      ls.workout_id AS last_workout_id,
      jsonb_agg(
        jsonb_build_object(
          'id', ws.id,
          'weight', ws.weight,
          'reps', ws.reps,
          'set_index', ws.set_index,
          'set_type', ws.set_type,
          'rpe', ws.rpe
        )
        ORDER BY ws.set_index ASC, ws.created_at ASC, ws.id ASC
      ) AS last_sets
    FROM last_sessions ls
    JOIN working_sets ws ON ws.exercise_id = ls.exercise_id AND ws.workout_id = ls.workout_id
    GROUP BY ls.exercise_id, ls.workout_date, ls.workout_id
  )
  SELECT
    req.ex_id AS exercise_id,
    pr.pr_weight,
    pr.pr_reps,
    pr.pr_date,
    pr.pr_workout_id,
    lsa.last_date,
    lsa.last_workout_id,
    COALESCE(lsa.last_sets, '[]'::jsonb) AS last_sets,
    pr.pr_e1rm
  FROM requested_exercises req
  LEFT JOIN pr_per_exercise pr ON pr.exercise_id = req.ex_id
  LEFT JOIN last_sets_agg lsa ON lsa.exercise_id = req.ex_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_exercise_benchmarks(uuid, date, uuid[], text) TO authenticated, anon;

-- 4. Drop existing get_exercise_stats overload so pg_proc remains unambiguous
DROP FUNCTION IF EXISTS public.get_exercise_stats(uuid);

-- 5. Re-create get_exercise_stats with trailing p_pr_mode parameter
CREATE OR REPLACE FUNCTION public.get_exercise_stats(
  p_user_id uuid,
  p_pr_mode text DEFAULT 'weight'
)
RETURNS TABLE (
  exercise_id uuid,
  exercise_name text,
  set_count bigint,
  max_weight numeric,
  pr_reps integer,
  pr_date date,
  recent_sets jsonb,
  pr_e1rm numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_pr_mode NOT IN ('weight', 'e1rm') THEN
    RAISE EXCEPTION 'invalid_pr_mode: %', p_pr_mode USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH user_sets AS (
    SELECT
      s.id,
      s.workout_id,
      s.exercise_id,
      s.weight,
      s.reps,
      s.set_index,
      s.set_type,
      s.rpe,
      s.created_at,
      w.workout_date,
      w.name AS workout_name
    FROM public.sets s
    JOIN public.workouts w ON s.workout_id = w.id
    WHERE w.user_id = p_user_id
  ),
  working_sets AS (
    SELECT * FROM user_sets
    WHERE COALESCE(set_type, 'working') NOT IN ('warmup', 'drop')
  ),
  pr_ranked AS (
    SELECT
      ws.exercise_id,
      ws.weight,
      ws.reps,
      ws.workout_date,
      ROW_NUMBER() OVER (
        PARTITION BY ws.exercise_id
        ORDER BY
          CASE
            WHEN p_pr_mode = 'e1rm' THEN
              CASE WHEN (ws.weight <= 0 OR ws.reps <= 12) THEN 1 ELSE 0 END
            ELSE 1
          END DESC,
          CASE
            WHEN p_pr_mode = 'e1rm' THEN
              CASE
                WHEN (ws.weight <= 0 OR ws.reps <= 12) THEN
                  CASE WHEN ws.weight <= 0 THEN 0.0 ELSE ROUND((ws.weight * (1.0 + ws.reps / 30.0))::numeric, 2) END
                ELSE ws.weight
              END
            ELSE ws.weight
          END DESC,
          ws.weight DESC,
          ws.reps DESC,
          ws.workout_date ASC,
          ws.created_at ASC,
          ws.id ASC
      ) as pr_rank
    FROM working_sets ws
  ),
  pr_per_exercise AS (
    SELECT
      pr.exercise_id,
      pr.weight AS max_weight,
      pr.reps AS pr_reps,
      pr.workout_date AS pr_date,
      CASE
        WHEN p_pr_mode = 'e1rm' THEN
          CASE
            WHEN pr.weight <= 0 THEN 0.0
            ELSE ROUND((pr.weight * (1.0 + pr.reps / 30.0))::numeric, 2)
          END
        ELSE NULL
      END AS pr_e1rm
    FROM pr_ranked pr
    WHERE pr.pr_rank = 1
  ),
  recent_ranked AS (
    SELECT
      ws.exercise_id,
      ws.id,
      ws.workout_id,
      ws.weight,
      ws.reps,
      ws.set_index,
      ws.set_type,
      ws.rpe,
      ws.workout_date,
      ws.workout_name,
      ROW_NUMBER() OVER (
        PARTITION BY ws.exercise_id
        ORDER BY ws.workout_date DESC, ws.set_index DESC, ws.created_at DESC, ws.id DESC
      ) as recent_rank
    FROM working_sets ws
  ),
  recent_per_exercise AS (
    SELECT
      rr.exercise_id,
      jsonb_agg(
        jsonb_build_object(
          'id', rr.id,
          'workout_id', rr.workout_id,
          'exercise_id', rr.exercise_id,
          'weight', rr.weight,
          'reps', rr.reps,
          'set_index', rr.set_index,
          'set_type', rr.set_type,
          'rpe', rr.rpe,
          'workout_date', rr.workout_date,
          'workout_name', rr.workout_name
        )
        ORDER BY rr.recent_rank ASC
      ) AS recent_sets
    FROM recent_ranked rr
    WHERE rr.recent_rank <= 3
    GROUP BY rr.exercise_id
  ),
  counts AS (
    SELECT
      ws.exercise_id,
      COUNT(*)::bigint AS set_count
    FROM working_sets ws
    GROUP BY ws.exercise_id
  )
  SELECT
    c.exercise_id,
    COALESCE(e.name, c.exercise_id::text) AS exercise_name,
    c.set_count,
    COALESCE(p.max_weight, 0)::numeric AS max_weight,
    COALESCE(p.pr_reps, 0)::integer AS pr_reps,
    p.pr_date,
    COALESCE(r.recent_sets, '[]'::jsonb) AS recent_sets,
    p.pr_e1rm
  FROM counts c
  LEFT JOIN public.exercises e ON e.id = c.exercise_id
  LEFT JOIN pr_per_exercise p ON p.exercise_id = c.exercise_id
  LEFT JOIN recent_per_exercise r ON r.exercise_id = c.exercise_id
  ORDER BY c.exercise_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_exercise_stats(uuid, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
