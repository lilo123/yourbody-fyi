-- Pre-migration shape audit for M7 (exercise_name_guard).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Column presence: routine_templates.updated_at (expected 0 before migration)
-- 2. Exercises row count
-- 3. Routine templates row count
-- 4. Collision counts under D-P7b-2 guard rules (must be 0 before unique index creation)
-- 5. Exercises checksum over ordered all columns
-- 6. Routine templates checksum over ordered core columns

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
coach_athlete_dups AS (
  SELECT a.id AS id1, c.id AS id2
  FROM normalized_exercises a
  JOIN public.coach_athlete_links ca ON ca.athlete_id = a.user_id AND ca.status = 'active'
  JOIN normalized_exercises c ON c.user_id = ca.coach_id
  WHERE a.is_master = false AND c.is_master = false AND a.norm_name = c.norm_name
    AND (a.norm_eq = c.norm_eq OR a.norm_eq = '' OR c.norm_eq = '')
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
)
SELECT 1 AS ord, 'Column presence: routine_templates.updated_at' AS metric, col_count::text AS value, '0' AS expectation FROM col_stats
UNION ALL SELECT 2, 'Exercises row count', (SELECT count(*)::text FROM public.exercises), 'matches live'
UNION ALL SELECT 3, 'Routine templates row count', (SELECT count(*)::text FROM public.routine_templates), 'matches live'
UNION ALL SELECT 4, 'Same-owner name collisions (master-master + owner-custom)', ((SELECT count(*) FROM master_master_dups) + (SELECT count(*) FROM owner_custom_dups))::text, '0'
UNION ALL SELECT 5, 'Custom vs Master name collisions', (SELECT count(*)::text FROM custom_master_dups), '0'
UNION ALL SELECT 6, 'Coach vs Athlete name collisions', (SELECT count(*)::text FROM coach_athlete_dups), '0'
UNION ALL SELECT 7, 'Exercises columns checksum (MD5)', (SELECT chk FROM exercises_chk), 'baseline'
UNION ALL SELECT 8, 'Routine templates checksum (MD5)', (SELECT chk FROM templates_chk), 'baseline'
ORDER BY ord;
