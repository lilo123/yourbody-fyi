-- Migration: 20261001000000_coach_code_prefix_yb.sql
-- Description: M11 coach-code prefix migration (CYBER- -> YB-).
-- Updates public.set_coach_code auto-generation prefix to 'YB-'.
-- Rewrites existing 'CYBER-%' coach codes to 'YB-%' after collision and regex validation.
-- Decisions: D-YB-4, D-YB-10.

-- 1. CREATE OR REPLACE public.set_coach_code with prefix 'YB-'
CREATE OR REPLACE FUNCTION public.set_coach_code(custom_code text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_code text;
  v_existing_code text;
  v_tries int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT coach_code INTO v_existing_code FROM public.users WHERE id = auth.uid();

  IF custom_code IS NOT NULL AND TRIM(custom_code) <> '' THEN
    v_code := UPPER(TRIM(custom_code));
    IF NOT (v_code ~ '^[A-Z0-9_-]{4,20}$') THEN
      RAISE EXCEPTION 'Coach code must be 4-20 alphanumeric characters, hyphens, or underscores.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users WHERE UPPER(coach_code) = v_code AND id <> auth.uid()) THEN
      RAISE EXCEPTION 'This coach code is already in use. Please choose another.';
    END IF;
  ELSIF v_existing_code IS NOT NULL AND v_existing_code <> '' THEN
    v_code := v_existing_code;
  ELSE
    LOOP
      v_code := 'YB-' || UPPER(SUBSTRING(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 6));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE UPPER(coach_code) = v_code) OR v_tries > 20;
      v_tries := v_tries + 1;
    END LOOP;
  END IF;

  UPDATE public.users 
  SET coach_code = v_code, 
      is_coach_mode = true,
      coach_tier = COALESCE(coach_tier, 'free'),
      max_athletes = COALESCE(max_athletes, 3)
  WHERE id = auth.uid();

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_coach_code(text) TO authenticated, service_role;

-- 2. Validate and rewrite existing 'CYBER-%' coach codes to 'YB-%'
DO $$
DECLARE
  v_collision_count integer;
  v_invalid_count integer;
BEGIN
  -- Abort if any target 'YB-' || substr(coach_code, 7) already exists case-insensitively
  SELECT count(*) INTO v_collision_count
  FROM public.users c
  WHERE c.coach_code LIKE 'CYBER-%'
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE UPPER(u.coach_code) = UPPER('YB-' || substr(c.coach_code, 7))
    );

  IF v_collision_count > 0 THEN
    RAISE EXCEPTION 'M11 migration aborted: % target YB- coach code(s) already exist', v_collision_count;
  END IF;

  -- Abort if any target code would fail the regex ^[A-Z0-9_-]{4,20}$
  SELECT count(*) INTO v_invalid_count
  FROM public.users c
  WHERE c.coach_code LIKE 'CYBER-%'
    AND NOT (('YB-' || substr(c.coach_code, 7)) ~ '^[A-Z0-9_-]{4,20}$');

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'M11 migration aborted: % target YB- coach code(s) fail regex ^[A-Z0-9_-]{4,20}$', v_invalid_count;
  END IF;

  -- Rewrite all 'CYBER-%' coach codes to 'YB-%'
  UPDATE public.users
  SET coach_code = 'YB-' || substr(coach_code, 7)
  WHERE coach_code LIKE 'CYBER-%';
END;
$$;
