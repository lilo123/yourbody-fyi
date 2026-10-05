-- Rollback 20260927020000_exercise_pr_benchmarks.down.sql
-- Restores pre-migration M3 state for get_exercise_benchmarks, get_exercise_stats, and sets index.

-- 1. Drop index on sets
DROP INDEX IF EXISTS public.idx_sets_exercise_working;

-- 2. Drop get_exercise_benchmarks RPC
DROP FUNCTION IF EXISTS public.get_exercise_benchmarks(uuid, date, uuid[]);

-- 3. Restore get_exercise_stats to pre-M3 definition (from 20260916215500_history_session_and_exercise_rpcs.sql)
DROP FUNCTION IF EXISTS public.get_exercise_stats(uuid);

CREATE OR REPLACE FUNCTION public.get_exercise_stats(
  p_user_id uuid
)
RETURNS TABLE (
  exercise_id uuid,
  set_count bigint,
  max_weight numeric,
  pr_reps integer,
  recent_sets jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    w.date AS workout_date,
    w.name AS workout_name
  FROM public.sets s
  JOIN public.workouts w ON s.workout_id = w.id
  WHERE w.user_id = p_user_id
),
pr_ranked AS (
  SELECT
    exercise_id,
    weight,
    reps,
    ROW_NUMBER() OVER (
      PARTITION BY exercise_id
      ORDER BY weight DESC, reps DESC, workout_date DESC, id DESC
    ) as pr_rank
  FROM user_sets
),
pr_per_exercise AS (
  SELECT
    exercise_id,
    weight AS max_weight,
    reps AS pr_reps
  FROM pr_ranked
  WHERE pr_rank = 1
),
recent_ranked AS (
  SELECT
    exercise_id,
    id,
    workout_id,
    weight,
    reps,
    set_index,
    set_type,
    rpe,
    workout_date,
    workout_name,
    ROW_NUMBER() OVER (
      PARTITION BY exercise_id
      ORDER BY workout_date DESC, set_index DESC, created_at DESC
    ) as recent_rank
  FROM user_sets
),
recent_per_exercise AS (
  SELECT
    exercise_id,
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'workout_id', workout_id,
        'exercise_id', exercise_id,
        'weight', weight,
        'reps', reps,
        'set_index', set_index,
        'set_type', set_type,
        'rpe', rpe,
        'workout_date', workout_date,
        'workout_name', workout_name
      )
      ORDER BY recent_rank ASC
    ) AS recent_sets
  FROM recent_ranked
  WHERE recent_rank <= 3
  GROUP BY exercise_id
),
counts AS (
  SELECT
    exercise_id,
    COUNT(*)::bigint AS set_count
  FROM user_sets
  GROUP BY exercise_id
)
SELECT
  c.exercise_id,
  c.set_count,
  COALESCE(p.max_weight, 0)::numeric AS max_weight,
  COALESCE(p.pr_reps, 0)::integer AS pr_reps,
  COALESCE(r.recent_sets, '[]'::jsonb) AS recent_sets
FROM counts c
LEFT JOIN pr_per_exercise p ON p.exercise_id = c.exercise_id
LEFT JOIN recent_per_exercise r ON r.exercise_id = c.exercise_id
ORDER BY c.exercise_id
LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.get_exercise_stats(uuid) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
