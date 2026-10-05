-- Pre-migration shape audit for M8 (default_catalog_seed).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Master exercises count with NULL equipment
-- 2. Total exercises count
-- 3. Master exercises count
-- 4. Exercises checksum over all columns EXCEPT equipment (ordered by id)

WITH ex_counts AS (
  SELECT
    count(*) AS total_count,
    count(*) FILTER (WHERE is_master = true) AS master_count,
    count(*) FILTER (WHERE is_master = true AND equipment IS NULL) AS master_null_eq_count
  FROM public.exercises
),
ex_chk_no_eq AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(exercises) - 'equipment')::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.exercises
),
eq_chk_untouchable AS (
  -- equipment of every row the backfill must NOT touch (anything except NULL-equipment masters)
  SELECT md5(coalesce(string_agg(id::text || ':' || coalesce(equipment, '<null>'), ',' ORDER BY id), '')) AS chk
  FROM public.exercises
  WHERE NOT (is_master = true AND equipment IS NULL)
)
SELECT 1 AS ord, 'Master exercises count with NULL equipment' AS metric, master_null_eq_count::text AS value, 'baseline' AS expectation FROM ex_counts
UNION ALL SELECT 2, 'Total exercises count', total_count::text, 'matches live' FROM ex_counts
UNION ALL SELECT 3, 'Master exercises count', master_count::text, 'matches live' FROM ex_counts
UNION ALL SELECT 4, 'Exercises checksum excluding equipment (MD5)', chk, 'baseline' FROM ex_chk_no_eq
UNION ALL SELECT 5, 'Equipment checksum of rows not eligible for backfill (MD5)', chk, 'baseline' FROM eq_chk_untouchable
ORDER BY ord;
