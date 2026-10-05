-- Pre-migration shape audit for M6 (users_weight_unit).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: users.weight_unit from information_schema (expected 0 before migration)
-- 2. Users row count
-- 3. Workouts row count
-- 4. Sets row count
-- 5. Sets checksum over ordered (id, weight, reps, set_type)

WITH col_stats AS (
  SELECT count(*) AS col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'weight_unit'
),
table_counts AS (
  SELECT
    (SELECT count(*) FROM public.users) AS users_count,
    (SELECT count(*) FROM public.workouts) AS workouts_count,
    (SELECT count(*) FROM public.sets) AS sets_count
),
sets_checksum AS (
  SELECT md5(coalesce(string_agg(
    id::text || ':' || coalesce(weight::text,'') || ':' || coalesce(reps::text,'') || ':' || coalesce(set_type,''),
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.sets
)
SELECT 1 AS ord, 'Column presence: users.weight_unit' AS metric, col_count::text AS value FROM col_stats
UNION ALL SELECT 2, 'Users row count', users_count::text FROM table_counts
UNION ALL SELECT 3, 'Workouts row count', workouts_count::text FROM table_counts
UNION ALL SELECT 4, 'Sets row count', sets_count::text FROM table_counts
UNION ALL SELECT 5, 'Sets column checksum (id, weight, reps, set_type) (MD5)', chk FROM sets_checksum
ORDER BY ord;
