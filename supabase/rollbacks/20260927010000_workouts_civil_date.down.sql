-- Rollback 20260927010000_workouts_civil_date.down.sql
-- Restores pre-migration M2 state for workouts table, triggers, and RPCs.

-- 1. Drop UNIQUE constraint on workouts
ALTER TABLE public.workouts
  DROP CONSTRAINT IF EXISTS workouts_user_id_workout_date_key;

-- 2. Drop trigger and function for workout_date
DROP TRIGGER IF EXISTS trg_set_workouts_civil_date ON public.workouts;
DROP FUNCTION IF EXISTS public.set_workouts_civil_date();
DROP FUNCTION IF EXISTS public.workout_civil_date(timestamptz, text);

-- 3. Drop workout_date column
ALTER TABLE public.workouts
  DROP COLUMN IF EXISTS workout_date;

-- 4. Restore get_history_sessions to pre-M2 definition (from 20260916215500_history_session_and_exercise_rpcs.sql)
DROP FUNCTION IF EXISTS public.get_history_sessions(uuid, int, int);

CREATE OR REPLACE FUNCTION public.get_history_sessions(
  p_user_id uuid,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  date timestamp with time zone,
  name text,
  set_count bigint,
  total_volume numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.date,
    w.name,
    COUNT(s.id)::bigint AS set_count,
    COALESCE(SUM(s.weight * s.reps), 0)::numeric AS total_volume
  FROM public.workouts w
  LEFT JOIN public.sets s ON s.workout_id = w.id
  WHERE w.user_id = p_user_id
  GROUP BY w.id, w.date, w.name
  ORDER BY w.date DESC, w.id DESC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 0), 500);
$$;

GRANT EXECUTE ON FUNCTION public.get_history_sessions(uuid, int, int) TO authenticated, anon;

-- 5. Restore get_ghost_sets to pre-M2 definition (from 20260916233000_get_ghost_sets_per_exercise_cap.sql)
DROP FUNCTION IF EXISTS public.get_ghost_sets(uuid, date);

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
