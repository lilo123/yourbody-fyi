-- Migration: 20260927030000_exercise_catalog.sql
-- Description: M4 (expand-first) exercise catalog and routines schema:
-- 1. exercises.body_parts text[] + GIN index
-- 2. exercises.equipment text with allowed CHECK constraint + partial index
-- 3. lower(name) index on exercises
-- 4. Pure additive backfill of body_parts and equipment (preserves checksum of existing columns)
-- 5. Compat trigger (RP-3) synchronizing body_part and body_parts
-- 6. exercise_hides table + RLS (own/coach/athlete visibility, defaults-only hiding)
-- 7. get_exercise_catalog RPC (keyset cursor, search, scopes, equipment filter, multi-coach hides, total_count)
-- 8. get_routine_catalog RPC (precedence ranking, embedded exercises JSON, keyset cursor, total_count)
-- Reference: Exercise catalog specification (RD-3, RD-11, RP-3).

-- 1. Helper function: parse and deduplicate body_parts tokens from body_part text
-- Splits on ',' and '/', trims tokens, drops empty, dedupes preserving first-seen order.
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

GRANT EXECUTE ON FUNCTION public.parse_exercise_body_parts(text) TO authenticated, anon;

-- Helper function: normalize text[] array (trim, drop empty, dedupe keeping first-seen order)
CREATE OR REPLACE FUNCTION public.normalize_exercise_body_parts(p_body_parts text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_body_parts IS NULL THEN NULL
    ELSE COALESCE(
      (
        SELECT array_agg(token ORDER BY first_seen)
        FROM (
          SELECT trim(t.token) AS token, MIN(t.ord) AS first_seen
          FROM unnest(p_body_parts) WITH ORDINALITY AS t(token, ord)
          WHERE length(trim(t.token)) > 0
          GROUP BY trim(t.token)
        ) s
      ),
      ARRAY[]::text[]
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_exercise_body_parts(text[]) TO authenticated, anon;

-- 2. Schema additions to public.exercises
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS body_parts text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS equipment text DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.exercises'::regclass
      AND conname = 'exercises_equipment_check'
  ) THEN
    ALTER TABLE public.exercises
      ADD CONSTRAINT exercises_equipment_check
      CHECK (equipment IS NULL OR equipment IN (
        'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'smith', 'other'
      ));
  END IF;
END $$;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_exercises_body_parts
  ON public.exercises USING gin (body_parts);

CREATE INDEX IF NOT EXISTS idx_exercises_equipment
  ON public.exercises (equipment)
  WHERE equipment IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_name_lower
  ON public.exercises (lower(name));

-- 4. Backfill (expand-first, strictly additive)
-- Preserves existing body_part, name, is_master, user_id, is_archived without mutation.
-- Equipment inferred only on is_master rows matching canonical regexes; custom rows remain NULL.
UPDATE public.exercises
SET
  body_parts = public.parse_exercise_body_parts(body_part),
  equipment = CASE
    WHEN NOT is_master THEN NULL
    WHEN name ~* '\m(barbell|bb)\M' THEN 'barbell'
    WHEN name ~* '\m(dumbbell|db)\M' THEN 'dumbbell'
    WHEN name ~* '\m(cable)\M' THEN 'cable'
    WHEN name ~* '\m(machine)\M' THEN 'machine'
    WHEN name ~* '\m(bodyweight|bw)\M' THEN 'bodyweight'
    WHEN name ~* '\m(kettlebell|kb)\M' THEN 'kettlebell'
    WHEN name ~* '\m(band|banded)\M' THEN 'band'
    WHEN name ~* '\m(smith)\M' THEN 'smith'
    ELSE NULL
  END;

-- 5. Compatibility trigger (RP-3)
-- Synchronizes body_part and body_parts for legacy and modern writers.
-- Delimiter decision: array_to_string(body_parts, ', ') is chosen because:
-- (a) Existing EditExerciseModal.tsx splits body_part on comma (',') to populate chip groups;
-- (b) Both ', ' and ' / ' round-trip cleanly into the exact same body_parts array via parse_exercise_body_parts;
-- (c) Unrelated UPDATEs (e.g. updating name or is_archived) never rewrite body_part, preserving
--     exact legacy text values such as 'Chest / Triceps' on Dips.
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
    -- Only body_part updated: recompute body_parts
    IF NEW.body_part IS DISTINCT FROM OLD.body_part AND NEW.body_parts IS NOT DISTINCT FROM OLD.body_parts THEN
      NEW.body_parts := public.parse_exercise_body_parts(NEW.body_part);
    -- Only body_parts updated: recompute body_part
    ELSIF NEW.body_parts IS DISTINCT FROM OLD.body_parts AND NEW.body_part IS NOT DISTINCT FROM OLD.body_part THEN
      NEW.body_parts := public.normalize_exercise_body_parts(NEW.body_parts);
      NEW.body_part := NULLIF(array_to_string(NEW.body_parts, ', '), '');
    -- Both updated in the same write:
    ELSIF NEW.body_parts IS DISTINCT FROM OLD.body_parts AND NEW.body_part IS DISTINCT FROM OLD.body_part THEN
      NEW.body_parts := public.normalize_exercise_body_parts(NEW.body_parts);
      IF NEW.body_part IS NULL AND NEW.body_parts IS NOT NULL THEN
        NEW.body_part := NULLIF(array_to_string(NEW.body_parts, ', '), '');
      END IF;
    END IF;
    -- If neither changed, leave both completely untouched!
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_exercise_body_parts ON public.exercises;
CREATE TRIGGER trg_sync_exercise_body_parts
  BEFORE INSERT OR UPDATE ON public.exercises
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_exercise_body_parts();

-- 6. Table public.exercise_hides + RLS (RD-3, L47)
CREATE TABLE IF NOT EXISTS public.exercise_hides (
  hidden_by uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT exercise_hides_pkey PRIMARY KEY (hidden_by, exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_hides_exercise_id
  ON public.exercise_hides(exercise_id);

ALTER TABLE public.exercise_hides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exercise_hides_select" ON public.exercise_hides;
CREATE POLICY "exercise_hides_select"
  ON public.exercise_hides
  FOR SELECT
  TO authenticated
  USING (
    hidden_by = auth.uid()
    OR public.is_coach_of(hidden_by)
    OR public.is_athlete_of(hidden_by)
  );

DROP POLICY IF EXISTS "exercise_hides_insert" ON public.exercise_hides;
CREATE POLICY "exercise_hides_insert"
  ON public.exercise_hides
  FOR INSERT
  TO authenticated
  WITH CHECK (
    hidden_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.exercises e
      WHERE e.id = exercise_id
        AND e.is_master = true
    )
  );

DROP POLICY IF EXISTS "exercise_hides_delete" ON public.exercise_hides;
CREATE POLICY "exercise_hides_delete"
  ON public.exercise_hides
  FOR DELETE
  TO authenticated
  USING (
    hidden_by = auth.uid()
  );

GRANT ALL ON TABLE public.exercise_hides TO authenticated;

-- 7. get_exercise_catalog RPC (RD-3, L23, L47, L48)
-- SECURITY INVOKER: user/coach permissions and exercise RLS are respected.
-- Paging: keyset cursor on (lower(name), id). Default limit 50, capped at 200.
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

GRANT EXECUTE ON FUNCTION public.get_exercise_catalog(text, text, text, boolean, int, text) TO authenticated, anon;

-- 8. get_routine_catalog RPC (RD-11, L33)
-- Precedence scoring: assigned (3) -> personal (2) -> master (1) -> other (0)
-- Ordered by score DESC, created_at DESC, id DESC.
-- Single round-trip with embedded exercises JSON.
CREATE OR REPLACE FUNCTION public.get_routine_catalog(
  p_user_id uuid DEFAULT auth.uid(),
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_cursor text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  is_master boolean,
  user_id uuid,
  assigned_to uuid,
  days_of_week text[],
  exercises jsonb,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_user uuid;
  v_limit int;
  v_search text;
  v_cur_score int := NULL;
  v_cur_created_at timestamptz := NULL;
  v_cur_id uuid := NULL;
  v_cursor_uuid uuid := NULL;
  v_decoded text;
BEGIN
  v_target_user := COALESCE(p_user_id, auth.uid());
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_search := NULLIF(trim(p_search), '');

  -- Keyset cursor resolution on (score, created_at, id)
  IF p_cursor IS NOT NULL AND length(trim(p_cursor)) > 0 THEN
    BEGIN
      v_decoded := convert_from(decode(p_cursor, 'base64'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      v_decoded := p_cursor;
    END;

    IF v_decoded ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_cursor_uuid := v_decoded::uuid;
    ELSIF position('::' in v_decoded) > 0 THEN
      -- Format: score::created_at_iso::id
      BEGIN
        v_cur_score := split_part(v_decoded, '::', 1)::int;
        v_cur_created_at := split_part(v_decoded, '::', 2)::timestamptz;
        v_cur_id := split_part(v_decoded, '::', 3)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_uuid := NULL;
      END;
    ELSE
      BEGIN
        v_cursor_uuid := trim(v_decoded)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_cursor_uuid := NULL;
      END;
    END IF;

    IF v_cursor_uuid IS NOT NULL THEN
      SELECT
        CASE
          WHEN r.assigned_to = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 3
          WHEN r.user_id = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 2
          WHEN r.is_master = true THEN 1
          ELSE 0
        END,
        r.created_at,
        r.id
      INTO v_cur_score, v_cur_created_at, v_cur_id
      FROM public.routine_templates r
      WHERE r.id = v_cursor_uuid;
    END IF;
  END IF;

  RETURN QUERY
  WITH scored_routines AS (
    SELECT
      r.id,
      r.name,
      COALESCE(r.is_master, false) AS is_master,
      r.user_id,
      r.assigned_to,
      r.days_of_week,
      r.created_at,
      CASE
        WHEN r.assigned_to = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 3
        WHEN r.user_id = v_target_user AND (r.is_master = false OR r.is_master IS NULL) THEN 2
        WHEN r.is_master = true THEN 1
        ELSE 0
      END AS precedence_score,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', te.id,
              'template_id', te.template_id,
              'exercise_id', te.exercise_id,
              'order_index', te.order_index,
              'target_sets', te.target_sets,
              'target_reps', te.target_reps,
              'exercise', jsonb_build_object('name', ex.name)
            )
            ORDER BY te.order_index ASC, te.created_at ASC, te.id ASC
          )
          FROM public.template_exercises te
          LEFT JOIN public.exercises ex ON ex.id = te.exercise_id
          WHERE te.template_id = r.id
        ),
        '[]'::jsonb
      ) AS exercises
    FROM public.routine_templates r
    WHERE
      -- Visibility filter: masters, caller's own, assigned to caller/target, or coach of target
      (
        r.is_master = true
        OR r.user_id = v_target_user
        OR r.assigned_to = v_target_user
        OR (v_target_user = auth.uid() AND r.user_id = auth.uid())
      )
      -- Search filter
      AND (
        v_search IS NULL OR lower(r.name) LIKE '%' || lower(v_search) || '%'
      )
  ),
  total_metric AS (
    SELECT count(*)::bigint AS full_count FROM scored_routines
  ),
  paged AS (
    SELECT
      sr.id,
      sr.name,
      sr.is_master,
      sr.user_id,
      sr.assigned_to,
      sr.days_of_week,
      sr.exercises,
      sr.created_at,
      tm.full_count AS total_count
    FROM scored_routines sr
    CROSS JOIN total_metric tm
    WHERE
      (
        v_cur_score IS NULL
        OR (
          sr.precedence_score < v_cur_score
          OR (sr.precedence_score = v_cur_score AND sr.created_at < v_cur_created_at)
          OR (sr.precedence_score = v_cur_score AND sr.created_at = v_cur_created_at AND sr.id < v_cur_id)
        )
      )
    ORDER BY sr.precedence_score DESC, sr.created_at DESC, sr.id DESC
    LIMIT v_limit
  )
  SELECT * FROM paged;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_routine_catalog(uuid, text, int, text) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
