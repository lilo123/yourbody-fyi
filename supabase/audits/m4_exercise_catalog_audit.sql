-- Pre-migration shape audit for M4 (exercise catalog).
-- Pure SELECT; leaves database completely untouched.
-- Rule 8 compliance: production-shape audit counting transform branches + pre-migration checksum.

WITH body_part_stats AS (
  SELECT
    count(*) AS total_exercises,
    count(*) FILTER (WHERE body_part IS NULL OR length(trim(body_part)) = 0) AS null_or_empty,
    count(*) FILTER (WHERE body_part NOT LIKE '%,%' AND body_part NOT LIKE '%/%' AND length(trim(body_part)) > 0) AS single_part,
    count(*) FILTER (WHERE body_part LIKE '%,%' AND body_part NOT LIKE '%/%') AS comma_only,
    count(*) FILTER (WHERE body_part LIKE '%/%' AND body_part NOT LIKE '%,%') AS slash_only,
    count(*) FILTER (WHERE body_part LIKE '%,%' AND body_part LIKE '%/%') AS both_comma_and_slash,
    count(DISTINCT body_part) AS distinct_body_parts,
    count(*) FILTER (WHERE is_master = true) AS master_count,
    count(*) FILTER (WHERE is_master = false) AS custom_count
  FROM public.exercises
),
equipment_inference AS (
  SELECT
    count(*) FILTER (WHERE name ~* '\m(barbell|bb)\M') AS eq_barbell,
    count(*) FILTER (WHERE name ~* '\m(dumbbell|db)\M') AS eq_dumbbell,
    count(*) FILTER (WHERE name ~* '\m(cable)\M') AS eq_cable,
    count(*) FILTER (WHERE name ~* '\m(machine)\M') AS eq_machine,
    count(*) FILTER (WHERE name ~* '\m(bodyweight|bw)\M') AS eq_bodyweight,
    count(*) FILTER (WHERE name ~* '\m(kettlebell|kb)\M') AS eq_kettlebell,
    count(*) FILTER (WHERE name ~* '\m(band|banded)\M') AS eq_band,
    count(*) FILTER (WHERE name ~* '\m(smith)\M') AS eq_smith,
    count(*) FILTER (WHERE NOT (name ~* '\m(barbell|bb|dumbbell|db|cable|machine|bodyweight|bw|kettlebell|kb|band|banded|smith)\M')) AS eq_unmatched
  FROM public.exercises WHERE is_master = true
),
checksum_val AS (
  SELECT md5(coalesce(string_agg(
    id::text || ':' || coalesce(name,'') || ':' || coalesce(body_part,'') || ':' || is_master::text || ':' || coalesce(user_id::text,'') || ':' || is_archived::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.exercises
)
SELECT 1 AS ord, 'Total exercises count' AS metric, total_exercises::text AS value FROM body_part_stats
UNION ALL SELECT 2, 'Exercises: master count', master_count::text FROM body_part_stats
UNION ALL SELECT 3, 'Exercises: custom count', custom_count::text FROM body_part_stats
UNION ALL SELECT 4, 'Body part: NULL or empty', null_or_empty::text FROM body_part_stats
UNION ALL SELECT 5, 'Body part: single token (no comma/slash)', single_part::text FROM body_part_stats
UNION ALL SELECT 6, 'Body part: comma only', comma_only::text FROM body_part_stats
UNION ALL SELECT 7, 'Body part: slash only', slash_only::text FROM body_part_stats
UNION ALL SELECT 8, 'Body part: both comma and slash', both_comma_and_slash::text FROM body_part_stats
UNION ALL SELECT 9, 'Body part: distinct raw string count', distinct_body_parts::text FROM body_part_stats
UNION ALL SELECT 10, 'Master eq inference: barbell', eq_barbell::text FROM equipment_inference
UNION ALL SELECT 11, 'Master eq inference: dumbbell', eq_dumbbell::text FROM equipment_inference
UNION ALL SELECT 12, 'Master eq inference: cable', eq_cable::text FROM equipment_inference
UNION ALL SELECT 13, 'Master eq inference: machine', eq_machine::text FROM equipment_inference
UNION ALL SELECT 14, 'Master eq inference: bodyweight', eq_bodyweight::text FROM equipment_inference
UNION ALL SELECT 15, 'Master eq inference: kettlebell', eq_kettlebell::text FROM equipment_inference
UNION ALL SELECT 16, 'Master eq inference: band', eq_band::text FROM equipment_inference
UNION ALL SELECT 17, 'Master eq inference: smith', eq_smith::text FROM equipment_inference
UNION ALL SELECT 18, 'Master eq inference: unmatched (leaves NULL)', eq_unmatched::text FROM equipment_inference
UNION ALL SELECT 19, 'Exercises pre-migration column checksum (MD5)', chk FROM checksum_val
ORDER BY ord;
