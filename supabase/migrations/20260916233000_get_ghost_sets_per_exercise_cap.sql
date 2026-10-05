-- ============================================================================
-- Yourbody — Ghost Sets RPC Per-Exercise Cap
-- Replaces global LIMIT 200 with per-exercise window cap of 20 sets (ordered by set_index ASC)
-- and non-binding backstop LIMIT 1000.
-- Must be SECURITY INVOKER so RLS on workouts/sets applies.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ghost_sets(
  p_user_id uuid,
  p_date date
)
RETURNS TABLE (
  id uuid,
  workout_id uuid,
  exercise_id uuid,
  exercise_name text,
  weight numeric,
  reps integer,
  set_index integer,
  set_type text,
  workout_date timestamptz,
  workout_name text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH user_workouts AS (
    SELECT w.id, w.date, w.name, w.created_at
    FROM public.workouts w
    WHERE w.user_id = p_user_id
      AND (w.date AT TIME ZONE 'UTC')::date < p_date
      AND (w.date AT TIME ZONE 'UTC')::date >= (p_date - INTERVAL '90 days')::date
  ),
  valid_sets AS (
    SELECT
      s.id,
      s.workout_id,
      s.exercise_id,
      COALESCE(e.name, s.exercise_id::text) AS exercise_name,
      s.weight,
      s.reps,
      s.set_index,
      s.set_type,
      s.created_at,
      uw.date AS workout_date,
      uw.name AS workout_name,
      uw.created_at AS workout_created_at
    FROM public.sets s
    JOIN user_workouts uw ON uw.id = s.workout_id
    LEFT JOIN public.exercises e ON e.id = s.exercise_id
    WHERE s.weight IS NOT NULL
      AND s.reps IS NOT NULL
  ),
  ranked_sessions AS (
    SELECT
      vs.*,
      DENSE_RANK() OVER (
        PARTITION BY lower(vs.exercise_name)
        ORDER BY vs.workout_date DESC, vs.workout_created_at DESC, vs.workout_id DESC
      ) AS session_rank
    FROM valid_sets vs
  ),
  exercise_sets AS (
    SELECT
      rs.*,
      ROW_NUMBER() OVER (
        PARTITION BY lower(rs.exercise_name)
        ORDER BY rs.set_index ASC, rs.created_at ASC, rs.id ASC
      ) AS set_num
    FROM ranked_sessions rs
    WHERE rs.session_rank = 1
  )
  SELECT
    es.id,
    es.workout_id,
    es.exercise_id,
    es.exercise_name,
    es.weight,
    es.reps,
    es.set_index,
    es.set_type,
    es.workout_date,
    es.workout_name,
    es.created_at
  FROM exercise_sets es
  WHERE es.set_num <= 20
  ORDER BY es.exercise_name ASC, es.set_index ASC
  LIMIT 1000;
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_sets(uuid, date) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
