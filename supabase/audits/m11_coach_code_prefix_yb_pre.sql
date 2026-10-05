-- Pre-migration shape audit for M11 (coach_code_prefix_yb).
-- Pure SELECT; leaves database completely untouched.
-- Validates:
-- 1. Users row count
-- 2. Users checksum over all columns EXCEPT coach_code (MD5)
-- 3. Checksum over projected CYBER->YB mapping (MD5)
-- 4. Count of users with coach_code LIKE 'CYBER-%'
-- 5. Count of users with coach_code LIKE 'YB-%'
-- 6. Coach athlete links count
-- 7. Function set_coach_code prosrc presence/prefix check
-- 8. Function set_coach_code prosecdef
-- 9. Function set_coach_code proconfig
-- 10. Function set_coach_code proacl

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    RAISE EXCEPTION 'Pre-audit invariant failure: public.users table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coach_athlete_links'
  ) THEN
    RAISE EXCEPTION 'Pre-audit invariant failure: public.coach_athlete_links table does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_coach_code' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Pre-audit invariant failure: public.set_coach_code function does not exist';
  END IF;
END;
$$;

WITH users_summary AS (
  SELECT
    count(*) AS total_users,
    count(*) FILTER (WHERE coach_code LIKE 'CYBER-%') AS cyber_count,
    count(*) FILTER (WHERE coach_code LIKE 'YB-%') AS yb_count
  FROM public.users
),
links_summary AS (
  SELECT count(*) AS links_count FROM public.coach_athlete_links
),
users_checksum AS (
  SELECT md5(coalesce(string_agg(
    (to_jsonb(users) - 'coach_code')::text,
    ',' ORDER BY id
  ), '')) AS chk
  FROM public.users
),
mapping_checksum AS (
  WITH mapping_rows AS (
    SELECT id::text || ':' || ('YB-' || substr(coach_code, 7)) AS mapped_code
    FROM public.users
    WHERE coach_code LIKE 'CYBER-%'
    UNION ALL
    SELECT id::text || ':' || coach_code AS mapped_code
    FROM public.users
    WHERE coach_code LIKE 'YB-%'
  )
  SELECT md5(coalesce(string_agg(mapped_code, ',' ORDER BY mapped_code), '')) AS chk
  FROM mapping_rows
),
func_metadata AS (
  SELECT
    CASE
      WHEN prosrc LIKE '%YB-%' AND prosrc NOT LIKE '%CYBER-%' THEN 'YB-'
      WHEN prosrc LIKE '%CYBER-%' AND prosrc NOT LIKE '%YB-%' THEN 'CYBER-'
      ELSE 'other'
    END AS prefix_status,
    prosecdef::text AS prosecdef_val,
    coalesce(array_to_string(proconfig, ','), '') AS proconfig_val,
    coalesce(array_to_string(proacl, ','), '') AS proacl_val
  FROM pg_proc
  WHERE proname = 'set_coach_code' AND pronamespace = 'public'::regnamespace
)
SELECT 1 AS ord, 'Users row count' AS metric, total_users::text AS value, 'baseline' AS expectation FROM users_summary
UNION ALL SELECT 2, 'Users checksum (all columns EXCEPT coach_code) (MD5)', chk, 'baseline' FROM users_checksum
UNION ALL SELECT 3, 'CYBER->YB mapping checksum (MD5)', chk, 'baseline' FROM mapping_checksum
UNION ALL SELECT 4, 'Count coach_code LIKE ''CYBER-%''', cyber_count::text, 'baseline' FROM users_summary
UNION ALL SELECT 5, 'Count coach_code LIKE ''YB-%''', yb_count::text, 'baseline' FROM users_summary
UNION ALL SELECT 6, 'Coach athlete links count', links_count::text, 'baseline' FROM links_summary
UNION ALL SELECT 7, 'set_coach_code generated prefix in prosrc', prefix_status, 'CYBER-' FROM func_metadata
UNION ALL SELECT 8, 'set_coach_code prosecdef', prosecdef_val, 'true' FROM func_metadata
UNION ALL SELECT 9, 'set_coach_code proconfig', proconfig_val, 'search_path=public, pg_temp' FROM func_metadata
UNION ALL SELECT 10, 'set_coach_code proacl', proacl_val, 'baseline' FROM func_metadata
ORDER BY ord;
