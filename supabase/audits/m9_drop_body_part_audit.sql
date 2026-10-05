-- Pre-migration shape audit for M9 (drop_body_part).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: exercises.body_part (expected 1 before migration)
-- 2. Trigger presence: trg_sync_exercise_body_parts
-- 3. Function presence: parse_exercise_body_parts and sync_exercise_body_parts
-- 4. Exercises with NULL or empty body_parts (must be 0 before dropping legacy column)
-- 5. Exercises checksum over (id, name, body_parts, equipment, is_master, user_id, is_archived)

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
empty_parts AS (
  SELECT count(*) AS empty_count
  FROM public.exercises
  WHERE body_parts IS NULL OR cardinality(body_parts) = 0
),
ex_chk AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(exercises) - 'body_part')::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.exercises
)
SELECT 1 AS ord, 'Column presence: exercises.body_part' AS metric, col_count::text AS value, '1' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Trigger presence: trg_sync_exercise_body_parts', trg_count::text, '>= 1' FROM trg_stats
UNION ALL SELECT 3, 'Function presence: parse/sync body_parts functions', fn_count::text, '2' FROM fn_stats
UNION ALL SELECT 4, 'Exercises with empty or NULL body_parts', empty_count::text, '0' FROM empty_parts
UNION ALL SELECT 5, 'Exercises checksum over modern columns (MD5)', chk, 'baseline' FROM ex_chk
ORDER BY ord;
