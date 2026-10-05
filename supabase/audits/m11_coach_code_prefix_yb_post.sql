-- Post-migration shape audit for M11 (coach_code_prefix_yb).
-- Pure SELECT; leaves database completely untouched.
-- Exits non-zero on invariant failure.
-- Validates:
-- 1. Users row count
-- 2. Users checksum over all columns EXCEPT coach_code (MD5)
-- 3. Checksum over post YB mapping (MD5) matches pre mapping
-- 4. Count of users with coach_code LIKE 'CYBER-%' (must be 0)
-- 5. Count of users with coach_code LIKE 'YB-%'
-- 6. Coach athlete links count
-- 7. Function set_coach_code prosrc contains 'YB-' and NOT 'CYBER-'
-- 8. Function set_coach_code prosecdef matches pre
-- 9. Function set_coach_code proconfig matches pre
-- 10. Function set_coach_code proacl matches pre

DO $$
DECLARE
  v_cyber_count int;
  v_prosrc text;
  v_prosecdef boolean;
  v_proconfig text[];
BEGIN
  -- 1. Invariant: zero CYBER- coach codes remain
  SELECT count(*) INTO v_cyber_count
  FROM public.users
  WHERE coach_code LIKE 'CYBER-%';

  IF v_cyber_count <> 0 THEN
    RAISE EXCEPTION 'Invariant failure: % users still have CYBER- coach code, expected 0', v_cyber_count;
  END IF;

  -- 2. Invariant: set_coach_code prosrc contains 'YB-' and NOT 'CYBER-'
  SELECT prosrc, prosecdef, proconfig INTO v_prosrc, v_prosecdef, v_proconfig
  FROM pg_proc
  WHERE proname = 'set_coach_code' AND pronamespace = 'public'::regnamespace;

  IF v_prosrc NOT LIKE '%YB-%' THEN
    RAISE EXCEPTION 'Invariant failure: set_coach_code prosrc does not contain YB-';
  END IF;

  IF v_prosrc LIKE '%CYBER-%' THEN
    RAISE EXCEPTION 'Invariant failure: set_coach_code prosrc still contains CYBER-';
  END IF;

  -- 3. Invariant: prosecdef must be true
  IF NOT v_prosecdef THEN
    RAISE EXCEPTION 'Invariant failure: set_coach_code is not SECURITY DEFINER';
  END IF;

  -- 4. Invariant: proconfig must contain search_path=public, pg_temp
  IF NOT ('search_path=public, pg_temp' = ANY(v_proconfig)) THEN
    RAISE EXCEPTION 'Invariant failure: set_coach_code does not have search_path=public, pg_temp';
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
SELECT 1 AS ord, 'Users row count' AS metric, total_users::text AS value, 'matches pre' AS expectation FROM users_summary
UNION ALL SELECT 2, 'Users checksum (all columns EXCEPT coach_code) (MD5)', chk, 'identical to pre' FROM users_checksum
UNION ALL SELECT 3, 'CYBER->YB mapping checksum (MD5)', chk, 'identical to pre' FROM mapping_checksum
UNION ALL SELECT 4, 'Count coach_code LIKE ''CYBER-%''', cyber_count::text, '0' FROM users_summary
UNION ALL SELECT 5, 'Count coach_code LIKE ''YB-%''', yb_count::text, 'reported' FROM users_summary
UNION ALL SELECT 6, 'Coach athlete links count', links_count::text, 'matches pre' FROM links_summary
UNION ALL SELECT 7, 'set_coach_code generated prefix in prosrc', prefix_status, 'YB-' FROM func_metadata
UNION ALL SELECT 8, 'set_coach_code prosecdef', prosecdef_val, 'identical to pre' FROM func_metadata
UNION ALL SELECT 9, 'set_coach_code proconfig', proconfig_val, 'identical to pre' FROM func_metadata
UNION ALL SELECT 10, 'set_coach_code proacl', proacl_val, 'identical to pre' FROM func_metadata
ORDER BY ord;
