-- Migration: 20260929020000_drop_body_part.sql
-- Description: M9 drop legacy body_part column and associated functions/triggers (D-P7b-4, L44)
-- 1. Drop trigger trg_sync_exercise_body_parts and functions sync_exercise_body_parts, parse_exercise_body_parts
-- 2. Recreate get_exercise_catalog without body_part column in RETURNS TABLE
-- 3. DROP COLUMN body_part on public.exercises

-- 1. Drop triggers and compat synchronization functions
DROP TRIGGER IF EXISTS trg_sync_exercise_body_parts ON public.exercises;
DROP FUNCTION IF EXISTS public.sync_exercise_body_parts();
DROP FUNCTION IF EXISTS public.parse_exercise_body_parts(text);

-- 2. Recreate get_exercise_catalog projecting only body_parts text[]
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

  -- Keyset cursor resolution on (lower(name), id)
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
      -- Visibility guard: caller can see master rows, own rows, and linked coach/athlete rows
      (
        e.is_master = true
        OR e.user_id = auth.uid()
        OR public.is_coach_of(e.user_id)
        OR public.is_athlete_of(e.user_id)
      )
      -- Archive filter: excluded unless scope is 'archived'
      AND (
        CASE
          WHEN v_scope = 'archived' THEN e.is_archived = true
          ELSE e.is_archived = false
        END
      )
      -- Scope filter
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
      -- Equipment filter
      AND (
        v_equipment IS NULL OR e.equipment = v_equipment
      )
      -- Search filter
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

GRANT EXECUTE ON FUNCTION public.get_exercise_catalog(text, text, text, boolean, int, text) TO authenticated, anon;

-- 3. Drop legacy column
ALTER TABLE public.exercises DROP COLUMN IF EXISTS body_part;

NOTIFY pgrst, 'reload schema';
