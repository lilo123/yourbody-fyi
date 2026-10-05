-- ============================================================================
-- Yourbody — Ghost Sets RPC
-- Replaces 90-day unbounded sets table transfer on /workout route.
-- Returns per exercise the sets of its single most recent prior session
-- within a 90-day window relative to p_date.
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
  )
  SELECT
    rs.id,
    rs.workout_id,
    rs.exercise_id,
    rs.exercise_name,
    rs.weight,
    rs.reps,
    rs.set_index,
    rs.set_type,
    rs.workout_date,
    rs.workout_name,
    rs.created_at
  FROM ranked_sessions rs
  WHERE rs.session_rank = 1
  ORDER BY rs.exercise_name ASC, rs.set_index ASC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.get_ghost_sets(uuid, date) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
