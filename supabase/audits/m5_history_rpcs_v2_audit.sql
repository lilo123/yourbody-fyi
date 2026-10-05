-- Pre-migration shape audit for M5 (history_rpcs_v2).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Function presence count for get_history_sessions_v2 and get_exercise_history (expected 0 before migration)
-- 2. Security definer functions count (must be 0)
-- 3. Grants for authenticated and anon roles
-- 4. Workouts and sets row counts
-- 5. Sets checksum over ordered (id, weight, reps, set_type)

WITH func_stats AS (
  SELECT
    count(*) FILTER (WHERE p.proname = 'get_history_sessions_v2') AS count_v2,
    count(*) FILTER (WHERE p.proname = 'get_exercise_history') AS count_ex,
    count(*) FILTER (WHERE p.proname IN ('get_history_sessions_v2', 'get_exercise_history') AND p.prosecdef = true) AS secdef_count,
    count(*) FILTER (WHERE p.proname = 'get_history_sessions_v2' AND array_to_string(p.proacl, ',') LIKE '%authenticated%') AS v2_auth_grant,
    count(*) FILTER (WHERE p.proname = 'get_history_sessions_v2' AND array_to_string(p.proacl, ',') LIKE '%anon%') AS v2_anon_grant,
    count(*) FILTER (WHERE p.proname = 'get_exercise_history' AND array_to_string(p.proacl, ',') LIKE '%authenticated%') AS ex_auth_grant,
    count(*) FILTER (WHERE p.proname = 'get_exercise_history' AND array_to_string(p.proacl, ',') LIKE '%anon%') AS ex_anon_grant
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
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
SELECT 1 AS ord, 'Function presence: get_history_sessions_v2' AS metric, count_v2::text AS value FROM func_stats
UNION ALL SELECT 2, 'Function presence: get_exercise_history', count_ex::text FROM func_stats
UNION ALL SELECT 3, 'Security definer functions count (must be 0)', secdef_count::text FROM func_stats
UNION ALL SELECT 4, 'Grant authenticated: get_history_sessions_v2', v2_auth_grant::text FROM func_stats
UNION ALL SELECT 5, 'Grant anon: get_history_sessions_v2', v2_anon_grant::text FROM func_stats
UNION ALL SELECT 6, 'Grant authenticated: get_exercise_history', ex_auth_grant::text FROM func_stats
UNION ALL SELECT 7, 'Grant anon: get_exercise_history', ex_anon_grant::text FROM func_stats
UNION ALL SELECT 8, 'Workouts row count', workouts_count::text FROM table_counts
UNION ALL SELECT 9, 'Sets row count', sets_count::text FROM table_counts
UNION ALL SELECT 10, 'Sets column checksum (id, weight, reps, set_type) (MD5)', chk FROM sets_checksum
ORDER BY ord;
