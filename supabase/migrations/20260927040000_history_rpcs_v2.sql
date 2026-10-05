-- Migration: 20260927040000_history_rpcs_v2.sql
-- Description: M5 history RPCs v2 (expand-first):
-- 1. get_history_sessions_v2: keyset pagination (workout_date DESC, id DESC), p_since filter, total_count
-- 2. get_exercise_history: exercise history paged by session, keyset cursor workout_date, total_sessions
-- Both functions:
-- - Filter working sets only (set_type = 'working' OR set_type IS NULL; warmup/drop excluded per RD-9/RD-20)
-- - STABLE, SECURITY INVOKER, SET search_path = public (RLS enforced: owner + active linked coach)
-- - Mirror v1 GRANTs: TO authenticated, anon
-- Reference: History RPC specification (RD-9, RD-20).

-- 1. get_history_sessions_v2
CREATE OR REPLACE FUNCTION public.get_history_sessions_v2(
  p_user_id uuid,
  p_since date DEFAULT NULL,
  p_before_date date DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit int DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  date timestamp with time zone,
  civil_date date,
  name text,
  set_count bigint,
  total_volume numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH paged_workouts AS (
    SELECT
      w.id,
      w.date,
      w.workout_date AS civil_date,
      w.name,
      w.workout_date
    FROM public.workouts w
    WHERE w.user_id = p_user_id
      AND (p_since IS NULL OR w.workout_date >= p_since)
      AND (
        p_before_date IS NULL
        OR (p_before_id IS NOT NULL AND (w.workout_date, w.id) < (p_before_date, p_before_id))
        OR (p_before_id IS NULL AND w.workout_date < p_before_date)
      )
    ORDER BY w.workout_date DESC, w.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
  )
  SELECT
    pw.id,
    pw.date,
    pw.civil_date,
    pw.name,
    COUNT(s.id)::bigint AS set_count,
    COALESCE(SUM(s.weight * s.reps), 0)::numeric AS total_volume,
    (
      SELECT count(*)::bigint
      FROM public.workouts w_cnt
      WHERE w_cnt.user_id = p_user_id
        AND (p_since IS NULL OR w_cnt.workout_date >= p_since)
    ) AS total_count
  FROM paged_workouts pw
  LEFT JOIN public.sets s
    ON s.workout_id = pw.id
   AND (s.set_type = 'working' OR s.set_type IS NULL)
  GROUP BY pw.id, pw.date, pw.civil_date, pw.name, pw.workout_date
  ORDER BY pw.workout_date DESC, pw.id DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_history_sessions_v2(uuid, date, date, uuid, int) TO authenticated, anon;

-- 2. get_exercise_history
CREATE OR REPLACE FUNCTION public.get_exercise_history(
  p_user_id uuid,
  p_exercise_id uuid,
  p_since date DEFAULT NULL,
  p_before date DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  workout_id uuid,
  civil_date date,
  workout_name text,
  set_id uuid,
  set_index int,
  weight numeric,
  reps int,
  rpe numeric,
  created_at timestamp with time zone,
  total_sessions bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matching_sessions AS (
    SELECT
      w.id AS workout_id,
      w.workout_date AS civil_date,
      w.name AS workout_name
    FROM public.workouts w
    WHERE w.user_id = p_user_id
      AND (p_since IS NULL OR w.workout_date >= p_since)
      AND (p_before IS NULL OR w.workout_date < p_before)
      AND EXISTS (
        SELECT 1
        FROM public.sets s
        WHERE s.workout_id = w.id
          AND s.exercise_id = p_exercise_id
          AND (s.set_type = 'working' OR s.set_type IS NULL)
      )
    ORDER BY w.workout_date DESC, w.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
  )
  SELECT
    ms.workout_id,
    ms.civil_date,
    ms.workout_name,
    s.id AS set_id,
    s.set_index,
    s.weight,
    s.reps,
    s.rpe,
    s.created_at,
    (
      SELECT count(*)::bigint
      FROM public.workouts w_tot
      WHERE w_tot.user_id = p_user_id
        AND (p_since IS NULL OR w_tot.workout_date >= p_since)
        AND EXISTS (
          SELECT 1
          FROM public.sets s_tot
          WHERE s_tot.workout_id = w_tot.id
            AND s_tot.exercise_id = p_exercise_id
            AND (s_tot.set_type = 'working' OR s_tot.set_type IS NULL)
        )
    ) AS total_sessions
  FROM matching_sessions ms
  JOIN public.sets s
    ON s.workout_id = ms.workout_id
   AND s.exercise_id = p_exercise_id
   AND (s.set_type = 'working' OR s.set_type IS NULL)
  ORDER BY ms.civil_date DESC, ms.workout_id DESC, s.set_index ASC, s.created_at ASC, s.id ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_exercise_history(uuid, uuid, date, date, int) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
