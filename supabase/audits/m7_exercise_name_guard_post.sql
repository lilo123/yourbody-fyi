-- Post-migration shape audit for M7 (exercise_name_guard).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: routine_templates.updated_at (must be 1)
-- 2. routine_templates rows with updated_at IS NULL (must be 0)
-- 3. Function public.normalize_exercise_name presence (must be 1)
-- 4. Partial index idx_exercises_owner_norm_name_eq presence (must be 1)
-- 5. Trigger trg_exercise_name_guard presence (must be 1)
-- 6. Exercises row count matches pre-migration
-- 7. Routine templates row count matches pre-migration
-- 8. Exercises checksum over ordered columns matches pre-migration
-- 9. Routine templates checksum over ordered columns matches pre-migration

WITH normalized_exercises AS (
  SELECT id, user_id, name, is_master, is_archived,
    lower(trim(regexp_replace(COALESCE(name, ''), '\s+', ' ', 'g'))) AS norm_name,
    lower(trim(COALESCE(equipment, ''))) AS norm_eq
  FROM public.exercises WHERE is_archived = false
),
master_master_dups AS (
  SELECT a.id AS id1, b.id AS id2
  FROM normalized_exercises a JOIN normalized_exercises b
    ON a.id < b.id AND a.is_master = true AND b.is_master = true AND a.norm_name = b.norm_name
   AND (a.norm_eq = b.norm_eq OR a.norm_eq = '' OR b.norm_eq = '')
),
owner_custom_dups AS (
  SELECT a.id AS id1, b.id AS id2
  FROM normalized_exercises a JOIN normalized_exercises b
    ON a.id < b.id AND a.user_id = b.user_id AND a.is_master = false AND b.is_master = false
   AND a.norm_name = b.norm_name AND (a.norm_eq = b.norm_eq OR a.norm_eq = '' OR b.norm_eq = '')
),
custom_master_dups AS (
  SELECT c.id AS id1, m.id AS id2
  FROM normalized_exercises c JOIN normalized_exercises m
    ON c.is_master = false AND m.is_master = true AND c.norm_name = m.norm_name
   AND (c.norm_eq = m.norm_eq OR c.norm_eq = '' OR m.norm_eq = '')
),
exercises_chk AS (
  SELECT md5(coalesce(string_agg(
    to_jsonb(exercises)::text,
    ',' ORDER BY id
  ), '')) AS chk FROM public.exercises
),
templates_chk AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(routine_templates) - 'updated_at')::text,
    ',' ORDER BY id
  ), '')) AS chk FROM public.routine_templates
),
col_stats AS (
  SELECT count(*) AS col_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'routine_templates' AND column_name = 'updated_at'
),
null_updated_at AS (
  SELECT count(*) AS null_count
  FROM public.routine_templates
  WHERE updated_at IS NULL
),
fn_stats AS (
  SELECT count(*) AS fn_count
  FROM pg_proc
  WHERE proname = 'normalize_exercise_name'
    AND pronamespace = 'public'::regnamespace
),
idx_stats AS (
  SELECT count(*) AS idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'exercises'
    AND indexname = 'idx_exercises_owner_norm_name_eq'
),
trg_stats AS (
  SELECT count(DISTINCT trigger_name) AS trg_count
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
    AND event_object_table = 'exercises'
    AND trigger_name = 'trg_exercise_name_guard'
)
SELECT 1 AS ord, 'Column presence: routine_templates.updated_at' AS metric, col_count::text AS value, '1' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Routine templates with updated_at IS NULL', null_count::text, '0' FROM null_updated_at
UNION ALL SELECT 3, 'Function presence: public.normalize_exercise_name', fn_count::text, '1' FROM fn_stats
UNION ALL SELECT 4, 'Index presence: idx_exercises_owner_norm_name_eq', idx_count::text, '1' FROM idx_stats
UNION ALL SELECT 5, 'Trigger presence: trg_exercise_name_guard', trg_count::text, '1' FROM trg_stats
UNION ALL SELECT 6, 'Exercises row count', (SELECT count(*)::text FROM public.exercises), 'matches pre'
UNION ALL SELECT 7, 'Routine templates row count', (SELECT count(*)::text FROM public.routine_templates), 'matches pre'
UNION ALL SELECT 8, 'Same-owner name collisions', ((SELECT count(*) FROM master_master_dups) + (SELECT count(*) FROM owner_custom_dups))::text, '0'
UNION ALL SELECT 9, 'Custom vs Master name collisions', (SELECT count(*)::text FROM custom_master_dups), '0'
UNION ALL SELECT 10, 'Exercises columns checksum (MD5)', (SELECT chk FROM exercises_chk), 'identical to pre'
UNION ALL SELECT 11, 'Routine templates checksum (MD5)', (SELECT chk FROM templates_chk), 'identical to pre'
ORDER BY ord;
