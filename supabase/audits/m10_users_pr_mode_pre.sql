-- Pre-migration shape audit for M10 (users_pr_mode).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: users.pr_mode from information_schema (expected 0 before migration)
-- 2. Users row count
-- 3. Workouts row count
-- 4. Sets row count
-- 5. Users checksum over all columns EXCEPT pr_mode (MD5)
-- 6. Sets checksum over ordered (id, weight, reps, set_type) (MD5)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Pre-audit invariant failure: public.users table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sets'
  ) THEN
    RAISE EXCEPTION 'Pre-audit invariant failure: public.sets table does not exist';
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
table_counts AS (
  SELECT
    (SELECT count(*) FROM public.users) AS users_count,
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
SELECT 1 AS ord, 'Column presence: users.pr_mode' AS metric, col_count::text AS value, '0' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Users row count', users_count::text, 'baseline' FROM table_counts
UNION ALL SELECT 3, 'Workouts row count', workouts_count::text, 'baseline' FROM table_counts
UNION ALL SELECT 4, 'Sets row count', sets_count::text, 'baseline' FROM table_counts
UNION ALL SELECT 5, 'Users checksum (all columns EXCEPT pr_mode) (MD5)', chk, 'baseline' FROM users_checksum
UNION ALL SELECT 6, 'Sets column checksum (id, weight, reps, set_type) (MD5)', chk, 'baseline' FROM sets_checksum
ORDER BY ord;
