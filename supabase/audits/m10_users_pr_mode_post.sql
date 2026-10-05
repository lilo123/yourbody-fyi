-- Post-migration shape audit for M10 (users_pr_mode).
-- Pure SELECT; leaves database completely untouched.
-- Exits non-zero on invariant failure.
-- Validates:
-- 1. Column presence: users.pr_mode from information_schema (must be 1)
-- 2. Users count with invalid pr_mode (must be 0)
-- 3. Users count with pr_mode <> 'weight' (must be 0 after fresh migration)
-- 4. Users count with pr_mode IS NULL (must be 0)
-- 5. Function presence & no overloads for get_exercise_benchmarks and get_exercise_stats
-- 6. Users row count matches pre-migration
-- 7. Workouts row count matches pre-migration
-- 8. Sets row count matches pre-migration
-- 9. Users checksum over all columns EXCEPT pr_mode matches pre-migration
-- 10. Sets checksum over ordered (id, weight, reps, set_type) matches pre-migration

DO $$
DECLARE
  v_col_count int;
  v_null_count int;
  v_invalid_count int;
  v_non_weight_count int;
  v_bm_proc_count int;
  v_stats_proc_count int;
BEGIN
  -- 1. Check column presence
  SELECT count(*) INTO v_col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pr_mode';

  IF v_col_count <> 1 THEN
    RAISE EXCEPTION 'Invariant failure: users.pr_mode column count is %, expected 1', v_col_count;
  END IF;

  -- 2. Check NULL pr_mode
  SELECT count(*) INTO v_null_count
  FROM public.users
  WHERE pr_mode IS NULL;

  IF v_null_count <> 0 THEN
    RAISE EXCEPTION 'Invariant failure: % users have NULL pr_mode, expected 0', v_null_count;
  END IF;

  -- 3. Check invalid pr_mode
  SELECT count(*) INTO v_invalid_count
  FROM public.users
  WHERE pr_mode NOT IN ('weight', 'e1rm');

  IF v_invalid_count <> 0 THEN
    RAISE EXCEPTION 'Invariant failure: % users have invalid pr_mode, expected 0', v_invalid_count;
  END IF;

  -- 4. Check count of pr_mode <> 'weight'
  SELECT count(*) INTO v_non_weight_count
  FROM public.users
  WHERE pr_mode <> 'weight';

  IF v_non_weight_count <> 0 THEN
    RAISE EXCEPTION 'Invariant failure: % users have pr_mode <> weight, expected 0', v_non_weight_count;
  END IF;

  -- 5. Check exactly 1 overload for get_exercise_benchmarks in public schema
  SELECT count(*) INTO v_bm_proc_count
  FROM pg_proc
  WHERE proname = 'get_exercise_benchmarks' AND pronamespace = 'public'::regnamespace;

  IF v_bm_proc_count <> 1 THEN
    RAISE EXCEPTION 'Invariant failure: get_exercise_benchmarks has % overloads, expected 1', v_bm_proc_count;
  END IF;

  -- 6. Check exactly 1 overload for get_exercise_stats in public schema
  SELECT count(*) INTO v_stats_proc_count
  FROM pg_proc
  WHERE proname = 'get_exercise_stats' AND pronamespace = 'public'::regnamespace;

  IF v_stats_proc_count <> 1 THEN
    RAISE EXCEPTION 'Invariant failure: get_exercise_stats has % overloads, expected 1', v_stats_proc_count;
  END IF;
END;
$$;

WITH col_stats AS (
  SELECT count(*) AS col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'pr_mode'
),
user_mode_stats AS (
  SELECT
    count(*) AS total_users,
    count(*) FILTER (WHERE pr_mode = 'weight') AS count_weight,
    count(*) FILTER (WHERE pr_mode = 'e1rm') AS count_e1rm,
    count(*) FILTER (WHERE pr_mode <> 'weight') AS count_non_weight,
    count(*) FILTER (WHERE pr_mode NOT IN ('weight', 'e1rm')) AS count_invalid
  FROM public.users
),
table_counts AS (
  SELECT
    (SELECT count(*) FROM public.workouts) AS workouts_count,
    (SELECT count(*) FROM public.sets) AS sets_count
),
users_checksum AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(users) - 'pr_mode')::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.users
),
sets_checksum AS (
  SELECT md5(coalesce(string_agg(
    id::text || ':' || coalesce(weight::text,'') || ':' || coalesce(reps::text,'') || ':' || coalesce(set_type,''),
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.sets
)
SELECT 1 AS ord, 'Column presence: users.pr_mode' AS metric, col_count::text AS value, '1' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Users row count', total_users::text, 'matches pre' FROM user_mode_stats
UNION ALL SELECT 3, 'Users count by pr_mode: weight', count_weight::text, 'matches total users' FROM user_mode_stats
UNION ALL SELECT 4, 'Users count by pr_mode: e1rm', count_e1rm::text, '0' FROM user_mode_stats
UNION ALL SELECT 5, 'Users count with pr_mode <> weight', count_non_weight::text, '0' FROM user_mode_stats
UNION ALL SELECT 6, 'Users count with pr_mode NOT IN (''weight'',''e1rm'')', count_invalid::text, '0' FROM user_mode_stats
UNION ALL SELECT 7, 'Workouts row count', workouts_count::text, 'matches pre' FROM table_counts
UNION ALL SELECT 8, 'Sets row count', sets_count::text, 'matches pre' FROM table_counts
UNION ALL SELECT 9, 'Users checksum (all columns EXCEPT pr_mode) (MD5)', chk, 'identical to pre' FROM users_checksum
UNION ALL SELECT 10, 'Sets column checksum (id, weight, reps, set_type) (MD5)', chk, 'identical to pre' FROM sets_checksum
ORDER BY ord;
