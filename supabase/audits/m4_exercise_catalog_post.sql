-- Post-migration shape audit for M4 (exercise catalog).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. body_parts is populated whenever body_part is not null (must be 0)
-- 2. body_parts matches the canonical split rule for all rows (must be 0)
-- 3. equipment is null on all custom exercises (must be 0)
-- 4. pre-migration column checksum is 100% identical (no mutation of existing columns)
-- 5. per-class equipment counts

WITH post_checks AS (
  SELECT
    count(*) AS total_exercises,
    count(*) FILTER (WHERE body_parts IS NULL AND body_part IS NOT NULL) AS null_parts_with_part,
    count(*) FILTER (WHERE body_part IS NOT NULL AND body_parts IS DISTINCT FROM public.parse_exercise_body_parts(body_part)) AS split_rule_mismatches,
    count(*) FILTER (WHERE is_master = false AND equipment IS NOT NULL) AS custom_with_equipment,
    count(*) FILTER (WHERE is_master = true AND equipment = 'barbell') AS eq_barbell,
    count(*) FILTER (WHERE is_master = true AND equipment = 'dumbbell') AS eq_dumbbell,
    count(*) FILTER (WHERE is_master = true AND equipment = 'cable') AS eq_cable,
    count(*) FILTER (WHERE is_master = true AND equipment = 'machine') AS eq_machine,
    count(*) FILTER (WHERE is_master = true AND equipment = 'bodyweight') AS eq_bodyweight,
    count(*) FILTER (WHERE is_master = true AND equipment = 'kettlebell') AS eq_kettlebell,
    count(*) FILTER (WHERE is_master = true AND equipment = 'band') AS eq_band,
    count(*) FILTER (WHERE is_master = true AND equipment = 'smith') AS eq_smith,
    count(*) FILTER (WHERE is_master = true AND equipment = 'other') AS eq_other,
    count(*) FILTER (WHERE is_master = true AND equipment IS NULL) AS eq_unmatched_null
  FROM public.exercises
),
checksum_val AS (
  SELECT md5(coalesce(string_agg(
    id::text || ':' || coalesce(name,'') || ':' || coalesce(body_part,'') || ':' || is_master::text || ':' || coalesce(user_id::text,'') || ':' || is_archived::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.exercises
)
SELECT 1 AS ord, 'Total exercises count' AS metric, total_exercises::text AS value, 'matches pre' AS expectation FROM post_checks
UNION ALL SELECT 2, 'body_parts IS NULL while body_part IS NOT NULL', null_parts_with_part::text, '0' FROM post_checks
UNION ALL SELECT 3, 'body_parts differs from split rule', split_rule_mismatches::text, '0' FROM post_checks
UNION ALL SELECT 4, 'equipment non-null on custom rows', custom_with_equipment::text, '0' FROM post_checks
UNION ALL SELECT 5, 'Master equipment: barbell', eq_barbell::text, 'count' FROM post_checks
UNION ALL SELECT 6, 'Master equipment: dumbbell', eq_dumbbell::text, 'count' FROM post_checks
UNION ALL SELECT 7, 'Master equipment: cable', eq_cable::text, 'count' FROM post_checks
UNION ALL SELECT 8, 'Master equipment: machine', eq_machine::text, 'count' FROM post_checks
UNION ALL SELECT 9, 'Master equipment: bodyweight', eq_bodyweight::text, 'count' FROM post_checks
UNION ALL SELECT 10, 'Master equipment: kettlebell', eq_kettlebell::text, 'count' FROM post_checks
UNION ALL SELECT 11, 'Master equipment: band', eq_band::text, 'count' FROM post_checks
UNION ALL SELECT 12, 'Master equipment: smith', eq_smith::text, 'count' FROM post_checks
UNION ALL SELECT 13, 'Master equipment: other', eq_other::text, 'count' FROM post_checks
UNION ALL SELECT 14, 'Master equipment: unmatched (NULL)', eq_unmatched_null::text, 'count' FROM post_checks
UNION ALL SELECT 15, 'Post-migration column checksum (MD5)', chk, 'identical to pre' FROM checksum_val
ORDER BY ord;
