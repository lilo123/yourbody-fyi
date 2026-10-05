-- Post-migration shape audit for M9 (drop_body_part).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: exercises.body_part (must be 0)
-- 2. Trigger presence: trg_sync_exercise_body_parts (must be 0)
-- 3. Function presence: parse_exercise_body_parts and sync_exercise_body_parts (must be 0)
-- 4. Exercises checksum over (id, name, body_parts, equipment, is_master, user_id, is_archived) identical to pre
-- 5. Exercises total row count matches pre-migration

WITH col_stats AS (
  SELECT count(*) AS col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'exercises' AND column_name = 'body_part'
),
trg_stats AS (
  SELECT count(DISTINCT trigger_name) AS trg_count
  FROM information_schema.triggers
  WHERE trigger_schema = 'public' AND event_object_table = 'exercises' AND trigger_name = 'trg_sync_exercise_body_parts'
),
fn_stats AS (
  SELECT count(*) AS fn_count
  FROM pg_proc
  WHERE proname IN ('parse_exercise_body_parts', 'sync_exercise_body_parts')
    AND pronamespace = 'public'::regnamespace
),
ex_chk AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(exercises) - 'body_part')::text,
    ',' ORDER BY id
  ), '')) AS chk,
  count(*) AS total_count
  FROM public.exercises
)
SELECT 1 AS ord, 'Column presence: exercises.body_part' AS metric, col_count::text AS value, '0' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Trigger presence: trg_sync_exercise_body_parts', trg_count::text, '0' FROM trg_stats
UNION ALL SELECT 3, 'Function presence: parse/sync body_parts functions', fn_count::text, '0' FROM fn_stats
UNION ALL SELECT 4, 'Exercises checksum over modern columns (MD5)', chk, 'identical to pre' FROM ex_chk
UNION ALL SELECT 5, 'Total exercises count', total_count::text, 'matches pre' FROM ex_chk
ORDER BY ord;
