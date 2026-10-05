-- Post-migration shape audit for M8 (default_catalog_seed).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Checksum of pre-existing exercises (excluding M8-inserted IDs and excluding equipment) matches pre-migration
-- 2. Rows in catalog_seed_backfill matches backfilled master rows
-- 3. Master exercises count with NULL equipment (must be 0)
-- 4. Master exercises with empty/NULL body_parts (must be 0)
-- 5. Master exercises count is >= 150
-- 6. Total exercises count

WITH m8_ids AS (
  SELECT id
  FROM public.exercises
  WHERE id = md5('m8:' || public.normalize_exercise_name(name))::uuid
),
pre_existing_chk AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(exercises) - 'equipment')::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.exercises
  WHERE id NOT IN (SELECT id FROM m8_ids)
),
backfill_stats AS (
  SELECT count(*) AS backfill_count FROM public.catalog_seed_backfill
),
eq_chk_untouchable AS (
  -- must equal pre row 5: pre-existing rows, minus backfilled ids, minus masters still NULL
  SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(equipment, '<null>'), ',' ORDER BY id), '')) AS chk
  FROM public.exercises
  WHERE id NOT IN (SELECT id FROM m8_ids)
    AND id NOT IN (SELECT exercise_id FROM public.catalog_seed_backfill)
    AND NOT (is_master = true AND equipment IS NULL)
),
ex_stats AS (
  SELECT
    count(*) AS total_count,
    count(*) FILTER (WHERE is_master = true) AS master_count,
    count(*) FILTER (WHERE is_master = true AND equipment IS NULL) AS master_null_eq_count,
    count(*) FILTER (WHERE is_master = true AND (body_parts IS NULL OR cardinality(body_parts) = 0)) AS master_empty_body_parts_count
  FROM public.exercises
)
SELECT 1 AS ord, 'Pre-existing exercises checksum excluding equipment (MD5)' AS metric, chk AS value, 'identical to pre' AS expectation FROM pre_existing_chk
UNION ALL SELECT 2, 'Rows recorded in catalog_seed_backfill', backfill_count::text, 'equals pre NULL master count matching CSV' FROM backfill_stats
UNION ALL SELECT 3, 'Master exercises with NULL equipment', master_null_eq_count::text, '0' FROM ex_stats
UNION ALL SELECT 4, 'Master exercises with empty/NULL body_parts', master_empty_body_parts_count::text, '0' FROM ex_stats
UNION ALL SELECT 5, 'Master exercises count (curated catalog >= 150)', master_count::text, '>= 150' FROM ex_stats
UNION ALL SELECT 6, 'Total exercises count', total_count::text, 'matches expected' FROM ex_stats
UNION ALL SELECT 7, 'Equipment checksum of rows not eligible for backfill (MD5)', chk, 'identical to pre row 5' FROM eq_chk_untouchable
ORDER BY ord;
