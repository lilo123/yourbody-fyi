BEGIN;
SELECT plan(8);

-- ============================================================================
-- 1. Apply Up: Drop legacy column and associated routines
-- ============================================================================
DROP TRIGGER IF EXISTS trg_sync_exercise_body_parts ON public.exercises;
DROP FUNCTION IF EXISTS public.sync_exercise_body_parts();
DROP FUNCTION IF EXISTS public.parse_exercise_body_parts(text);
DROP FUNCTION IF EXISTS public.get_exercise_catalog(text, text, text, boolean, int, text);

CREATE OR REPLACE FUNCTION public.get_exercise_catalog(
  p_search text DEFAULT NULL,
  p_scope text DEFAULT 'all',
  p_equipment text DEFAULT NULL,
  p_include_hidden boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_cursor text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  body_parts text[],
  equipment text,
  is_master boolean,
  user_id uuid,
  is_archived boolean,
  is_hidden boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit int;
  v_search text;
  v_scope text;
  v_equipment text;
  v_cursor_name text := NULL;
  v_cursor_id uuid := NULL;
  v_decoded text;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  v_search := NULLIF(trim(p_search), '');
  v_scope := COALESCE(NULLIF(lower(trim(p_scope)), ''), 'all');
  v_equipment := NULLIF(lower(trim(p_equipment)), '');
  IF v_equipment = 'all' THEN
    v_equipment := NULL;
  END IF;

  IF p_cursor IS NOT NULL AND length(trim(p_cursor)) > 0 THEN
    BEGIN
      v_decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      v_decoded := p_cursor;
    END;

    IF v_decoded ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT lower(e.name), e.id INTO v_cursor_name, v_cursor_id
      FROM public.exercises e WHERE e.id = v_decoded::uuid;
    ELSIF position('::' in v_decoded) > 0 THEN
      v_cursor_name := lower(trim(split_part(v_decoded, '::', 1)));
      BEGIN
        v_cursor_id := split_part(v_decoded, '::', 2)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_id := NULL;
      END;
    ELSE
      BEGIN
        SELECT lower(e.name), e.id INTO v_cursor_name, v_cursor_id
        FROM public.exercises e WHERE e.id = trim(v_decoded)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_name := lower(trim(v_decoded));
        v_cursor_id := NULL;
      END;
    END IF;
  END IF;

  RETURN QUERY
  WITH visible_exercises AS (
    SELECT
      e.id,
      e.name,
      e.body_parts,
      e.equipment,
      e.is_master,
      e.user_id,
      e.is_archived,
      EXISTS (
        SELECT 1 FROM public.exercise_hides h
        WHERE h.exercise_id = e.id
          AND (h.hidden_by = auth.uid() OR public.is_athlete_of(h.hidden_by))
      ) AS is_hidden
    FROM public.exercises e
    WHERE
      (
        e.is_master = true
        OR e.user_id = auth.uid()
        OR public.is_coach_of(e.user_id)
        OR public.is_athlete_of(e.user_id)
      )
      AND (
        CASE
          WHEN v_scope = 'archived' THEN e.is_archived = true
          ELSE e.is_archived = false
        END
      )
      AND (
        CASE
          WHEN v_scope IN ('all', 'archived') THEN true
          WHEN v_scope = 'defaults' THEN e.is_master = true
          WHEN v_scope = 'mine' THEN (e.user_id = auth.uid() AND NOT e.is_master)
          WHEN v_scope IN ('coach', 'from_coach') THEN (public.is_athlete_of(e.user_id) AND NOT e.is_master)
          WHEN v_scope IN ('athlete', 'athletes') THEN (public.is_coach_of(e.user_id) AND NOT e.is_master)
          WHEN v_scope = 'hidden' THEN true
          ELSE true
        END
      )
      AND (
        v_equipment IS NULL OR e.equipment = v_equipment
      )
      AND (
        v_search IS NULL
        OR lower(e.name) LIKE '%' || lower(v_search) || '%'
        OR (
          e.body_parts IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM unnest(e.body_parts) bp
            WHERE lower(bp) = lower(v_search)
               OR lower(bp) LIKE '%' || lower(v_search) || '%'
          )
        )
      )
  ),
  filtered_with_hides AS (
    SELECT ve.*
    FROM visible_exercises ve
    WHERE
      CASE
        WHEN v_scope = 'hidden' THEN ve.is_hidden = true
        WHEN p_include_hidden THEN true
        ELSE ve.is_hidden = false
      END
  ),
  total_metric AS (
    SELECT count(*)::bigint AS full_count FROM filtered_with_hides
  ),
  paged AS (
    SELECT
      f.id,
      f.name,
      f.body_parts,
      f.equipment,
      f.is_master,
      f.user_id,
      f.is_archived,
      f.is_hidden,
      tm.full_count AS total_count
    FROM filtered_with_hides f
    CROSS JOIN total_metric tm
    WHERE
      (
        v_cursor_name IS NULL
        OR (
          v_cursor_id IS NOT NULL AND (
            lower(f.name) > v_cursor_name
            OR (lower(f.name) = v_cursor_name AND f.id > v_cursor_id)
          )
        )
        OR (
          v_cursor_id IS NULL AND lower(f.name) > v_cursor_name
        )
      )
    ORDER BY lower(f.name) ASC, f.id ASC
    LIMIT v_limit
  )
  SELECT * FROM paged;
END;
$$;

ALTER TABLE public.exercises DROP COLUMN IF EXISTS body_part;

-- Assert Up State
SELECT hasnt_column('public', 'exercises', 'body_part', 'After M9, exercises.body_part column is absent');
SELECT hasnt_function('public', 'parse_exercise_body_parts', 'parse_exercise_body_parts function is dropped');
SELECT hasnt_function('public', 'sync_exercise_body_parts', 'sync_exercise_body_parts trigger function is dropped');

DO $$
DECLARE
  v_count int;
  v_rec record;
BEGIN
  -- Verify get_exercise_catalog functions properly without body_part
  SELECT count(*) INTO v_count FROM public.get_exercise_catalog(p_limit := 10);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'get_exercise_catalog returned 0 rows after dropping body_part';
  END IF;

  SELECT * INTO v_rec FROM public.get_exercise_catalog(p_limit := 1);
  IF v_rec.body_parts IS NULL OR cardinality(v_rec.body_parts) = 0 THEN
    RAISE EXCEPTION 'get_exercise_catalog returned empty body_parts';
  END IF;
END;
$$;

SELECT pass('get_exercise_catalog functions correctly after dropping body_part column');

-- ============================================================================
-- 2. Rehearse Down (Rollback)
-- ============================================================================
ALTER TABLE public.exercises ADD COLUMN IF NOT EXISTS body_part text;
UPDATE public.exercises
SET body_part = COALESCE(array_to_string(body_parts, ', '), body_parts[1])
WHERE body_part IS NULL;

CREATE OR REPLACE FUNCTION public.parse_exercise_body_parts(p_body_part text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_body_part IS NULL THEN NULL
    ELSE COALESCE(
      (
        SELECT array_agg(token ORDER BY first_seen)
        FROM (
          SELECT trim(t.token) AS token, MIN(t.ord) AS first_seen
          FROM unnest(regexp_split_to_array(p_body_part, '[,/]')) WITH ORDINALITY AS t(token, ord)
          WHERE length(trim(t.token)) > 0
          GROUP BY trim(t.token)
        ) s
      ),
      ARRAY[]::text[]
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_exercise_body_parts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.body_parts IS NOT NULL AND NEW.body_part IS NULL THEN
      NEW.body_parts := public.normalize_exercise_body_parts(NEW.body_parts);
      NEW.body_part := NULLIF(array_to_string(NEW.body_parts, ', '), '');
    ELSIF NEW.body_part IS NOT NULL AND NEW.body_parts IS NULL THEN
      NEW.body_parts := public.parse_exercise_body_parts(NEW.body_part);
    ELSIF NEW.body_parts IS NOT NULL AND NEW.body_part IS NOT NULL THEN
      NEW.body_parts := public.normalize_exercise_body_parts(NEW.body_parts);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.body_part IS DISTINCT FROM OLD.body_part AND NEW.body_parts IS NOT DISTINCT FROM OLD.body_parts THEN
      NEW.body_parts := public.parse_exercise_body_parts(NEW.body_part);
    ELSIF NEW.body_parts IS DISTINCT FROM OLD.body_parts AND NEW.body_part IS DISTINCT FROM OLD.body_part THEN
      NEW.body_parts := public.normalize_exercise_body_parts(NEW.body_parts);
      NEW.body_part := NULLIF(array_to_string(NEW.body_parts, ', '), '');
    ELSIF NEW.body_parts IS DISTINCT FROM OLD.body_parts AND NEW.body_part IS DISTINCT FROM OLD.body_part THEN
      NEW.body_parts := public.normalize_exercise_body_parts(NEW.body_parts);
      IF NEW.body_part IS NULL AND NEW.body_parts IS NOT NULL THEN
        NEW.body_part := NULLIF(array_to_string(NEW.body_parts, ', '), '');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_exercise_body_parts ON public.exercises;
CREATE TRIGGER trg_sync_exercise_body_parts
  BEFORE INSERT OR UPDATE OF body_part, body_parts
  ON public.exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_exercise_body_parts();

DROP FUNCTION IF EXISTS public.get_exercise_catalog(text, text, text, boolean, int, text);

CREATE OR REPLACE FUNCTION public.get_exercise_catalog(
  p_search text DEFAULT NULL,
  p_scope text DEFAULT 'all',
  p_equipment text DEFAULT NULL,
  p_include_hidden boolean DEFAULT false,
  p_limit int DEFAULT 50,
  p_cursor text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  body_parts text[],
  body_part text,
  equipment text,
  is_master boolean,
  user_id uuid,
  is_archived boolean,
  is_hidden boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit int;
  v_search text;
  v_scope text;
  v_equipment text;
  v_cursor_name text := NULL;
  v_cursor_id uuid := NULL;
  v_decoded text;
BEGIN
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);

  v_search := NULLIF(trim(p_search), '');
  v_scope := COALESCE(NULLIF(lower(trim(p_scope)), ''), 'all');
  v_equipment := NULLIF(lower(trim(p_equipment)), '');
  IF v_equipment = 'all' THEN
    v_equipment := NULL;
  END IF;

  IF p_cursor IS NOT NULL AND length(trim(p_cursor)) > 0 THEN
    BEGIN
      v_decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      v_decoded := p_cursor;
    END;

    IF v_decoded ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT lower(e.name), e.id INTO v_cursor_name, v_cursor_id
      FROM public.exercises e WHERE e.id = v_decoded::uuid;
    ELSIF position('::' in v_decoded) > 0 THEN
      v_cursor_name := lower(trim(split_part(v_decoded, '::', 1)));
      BEGIN
        v_cursor_id := split_part(v_decoded, '::', 2)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_id := NULL;
      END;
    ELSE
      BEGIN
        SELECT lower(e.name), e.id INTO v_cursor_name, v_cursor_id
        FROM public.exercises e WHERE e.id = trim(v_decoded)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_name := lower(trim(v_decoded));
        v_cursor_id := NULL;
      END;
    END IF;
  END IF;

  RETURN QUERY
  WITH visible_exercises AS (
    SELECT
      e.id,
      e.name,
      e.body_parts,
      e.body_part,
      e.equipment,
      e.is_master,
      e.user_id,
      e.is_archived,
      EXISTS (
        SELECT 1 FROM public.exercise_hides h
        WHERE h.exercise_id = e.id
          AND (h.hidden_by = auth.uid() OR public.is_athlete_of(h.hidden_by))
      ) AS is_hidden
    FROM public.exercises e
    WHERE
      (
        e.is_master = true
        OR e.user_id = auth.uid()
        OR public.is_coach_of(e.user_id)
        OR public.is_athlete_of(e.user_id)
      )
      AND (
        CASE
          WHEN v_scope = 'archived' THEN e.is_archived = true
          ELSE e.is_archived = false
        END
      )
      AND (
        CASE
          WHEN v_scope IN ('all', 'archived') THEN true
          WHEN v_scope = 'defaults' THEN e.is_master = true
          WHEN v_scope = 'mine' THEN (e.user_id = auth.uid() AND NOT e.is_master)
          WHEN v_scope IN ('coach', 'from_coach') THEN (public.is_athlete_of(e.user_id) AND NOT e.is_master)
          WHEN v_scope IN ('athlete', 'athletes') THEN (public.is_coach_of(e.user_id) AND NOT e.is_master)
          WHEN v_scope = 'hidden' THEN true
          ELSE true
        END
      )
      AND (
        v_equipment IS NULL OR e.equipment = v_equipment
      )
      AND (
        v_search IS NULL
        OR lower(e.name) LIKE '%' || lower(v_search) || '%'
        OR (e.body_part IS NOT NULL AND lower(e.body_part) LIKE '%' || lower(v_search) || '%')
        OR (
          e.body_parts IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM unnest(e.body_parts) bp
            WHERE lower(bp) = lower(v_search)
               OR lower(bp) LIKE '%' || lower(v_search) || '%'
          )
        )
      )
  ),
  filtered_with_hides AS (
    SELECT ve.*
    FROM visible_exercises ve
    WHERE
      CASE
        WHEN v_scope = 'hidden' THEN ve.is_hidden = true
        WHEN p_include_hidden THEN true
        ELSE ve.is_hidden = false
      END
  ),
  total_metric AS (
    SELECT count(*)::bigint AS full_count FROM filtered_with_hides
  ),
  paged AS (
    SELECT
      f.id,
      f.name,
      f.body_parts,
      f.body_part,
      f.equipment,
      f.is_master,
      f.user_id,
      f.is_archived,
      f.is_hidden,
      tm.full_count AS total_count
    FROM filtered_with_hides f
    CROSS JOIN total_metric tm
    WHERE
      (
        v_cursor_name IS NULL
        OR (
          v_cursor_id IS NOT NULL AND (
            lower(f.name) > v_cursor_name
            OR (lower(f.name) = v_cursor_name AND f.id > v_cursor_id)
          )
        )
        OR (
          v_cursor_id IS NULL AND lower(f.name) > v_cursor_name
        )
      )
    ORDER BY lower(f.name) ASC, f.id ASC
    LIMIT v_limit
  )
  SELECT * FROM paged;
END;
$$;

-- Assert Down State
SELECT has_column('public', 'exercises', 'body_part', 'M9 rollback restores exercises.body_part column');
SELECT has_function('public', 'parse_exercise_body_parts', 'M9 rollback restores parse_exercise_body_parts');
SELECT has_trigger('public', 'exercises', 'trg_sync_exercise_body_parts', 'M9 rollback restores trg_sync_exercise_body_parts');

DO $$
DECLARE
  v_null_body_part_count int;
BEGIN
  SELECT count(*) INTO v_null_body_part_count FROM public.exercises WHERE body_part IS NULL;
  IF v_null_body_part_count > 0 THEN
    RAISE EXCEPTION 'M9 rollback failed to backfill body_part (% rows NULL)', v_null_body_part_count;
  END IF;
END;
$$;

SELECT pass('M9 rollback successfully backfilled body_part from body_parts');

SELECT * FROM finish();
ROLLBACK;
