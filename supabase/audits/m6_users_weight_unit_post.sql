-- Post-migration shape audit for M6 (users_weight_unit).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: users.weight_unit from information_schema (must be 1)
-- 2. Users row count matches pre-migration
-- 3. Users count by weight_unit ('lb' matches total users, 'kg' is 0)
-- 4. Users count with invalid weight_unit (must be 0)
-- 5. Workouts row count matches pre-migration
-- 6. Sets row count matches pre-migration
-- 7. Sets checksum over ordered (id, weight, reps, set_type) matches pre-migration (invariance)

WITH col_stats AS (
  SELECT count(*) AS col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'weight_unit'
),
user_unit_stats AS (
  SELECT
    count(*) AS total_users,
    count(*) FILTER (WHERE weight_unit = 'lb') AS count_lb,
    count(*) FILTER (WHERE weight_unit = 'kg') AS count_kg,
    count(*) FILTER (WHERE weight_unit NOT IN ('lb', 'kg')) AS count_invalid
  FROM public.users
),
table_counts AS (
  SELECT
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
SELECT 1 AS ord, 'Column presence: users.weight_unit' AS metric, col_count::text AS value, '1' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Users row count', total_users::text, 'matches pre' FROM user_unit_stats
UNION ALL SELECT 3, 'Users count by weight_unit: lb', count_lb::text, 'matches total users' FROM user_unit_stats
UNION ALL SELECT 4, 'Users count by weight_unit: kg', count_kg::text, '0' FROM user_unit_stats
UNION ALL SELECT 5, 'Users count with weight_unit NOT IN (''lb'',''kg'')', count_invalid::text, '0' FROM user_unit_stats
UNION ALL SELECT 6, 'Workouts row count', workouts_count::text, 'matches pre' FROM table_counts
UNION ALL SELECT 7, 'Sets row count', sets_count::text, 'matches pre' FROM table_counts
UNION ALL SELECT 8, 'Sets column checksum (id, weight, reps, set_type) (MD5)', chk, 'identical to pre' FROM sets_checksum
ORDER BY ord;
