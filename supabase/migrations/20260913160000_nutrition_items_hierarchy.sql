-- ============================================================================
-- Nutrition hierarchy — Phase 2: additive DDL + backfill
-- ----------------------------------------------------------------------------
-- Adds a nullable `items jsonb` column to public.nutrition_logs and
-- public.custom_dishes, holding the level-2 component breakdown of a level-1
-- parent (a meal or a custom dish).
--
-- Properties this migration is required to have (see plan §12 Phase 2):
--   * additive only   — no column is dropped, no data is destroyed
--   * reversible      — see supabase/rollback/20260913160000_down.sql
--   * idempotent      — re-running changes zero rows
--   * guarded         — a shape CHECK rejects [] , non-arrays, runaway arrays
--                       and per-item negative macros
--
-- Deliberately NOT in this migration: the parent = SUM(items) constraint.
-- That ships separately (Phase 5) so that a constraint failure cannot break
-- logging for a client that is already in the field.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper schema.
--    `private` is not in supabase/config.toml's exposed schema list, so nothing
--    here is published by PostgREST as an /rpc/ endpoint.
--
--    EXECUTE is deliberately NOT revoked from anon/authenticated. A CHECK
--    constraint's expression is ACL-checked as the calling role at expression
--    *initialisation*, before `items IS NULL` can short-circuit, so revoking
--    would break every INSERT into these tables — including rows that carry no
--    items at all. Verified empirically; do not "harden" this.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;

-- Sum one macro key across an items array. Non-object elements and non-number
-- values are coerced to 0 rather than raising, so a malformed payload produces
-- a clean constraint violation instead of `invalid input syntax for numeric`.
CREATE OR REPLACE FUNCTION private.items_macro_sum(items jsonb, key text)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(SUM(CASE WHEN jsonb_typeof(e -> key) = 'number'
                           THEN (e ->> key)::numeric ELSE 0 END), 0)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array'
                                 THEN items ELSE '[]'::jsonb END) AS e
  WHERE jsonb_typeof(e) = 'object'
$$;

-- Smallest numeric macro found anywhere in an items array (0 when there is
-- none). Used for per-item non-negativity: a CHECK cannot contain a subquery,
-- so `NOT EXISTS (SELECT ... FROM jsonb_array_elements(...))` does not compile.
CREATE OR REPLACE FUNCTION private.items_min_macro(items jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(MIN((e ->> k)::numeric), 0)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(items) = 'array'
                                 THEN items ELSE '[]'::jsonb END) AS e
  CROSS JOIN LATERAL unnest(ARRAY['calories','protein','carbs','fat','fiber']) AS k
  WHERE jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> k) = 'number'
$$;

-- ----------------------------------------------------------------------------
-- 2. Portion string -> canonical (quantity, unit).
--    A SQL mirror of src/utils/unitConverter.ts. The two are pinned to each
--    other by src/utils/unitConverter.test.ts (the SQL results for all 17 real
--    production portion strings are asserted there as a literal table).
--
--    Rule order is load-bearing and matches the TS port exactly:
--      1. parenthesised mass/volume hint  ('1 g (2 g)' -> 2 g)
--      2. leading number + mass/volume unit
--      3. a fraction anywhere -> unsupported, low confidence
--      4. leading number followed by whitespace or end -> count, medium
--      5. otherwise -> (1, 'unit', 'low')
--
--    Every numeric capture uses `[0-9]+(\.[0-9]+)?` rather than a greedy
--    `[0-9.]+`, because the latter matches '1..5', which is not a number.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.portion_to_canonical(portion text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  max_quantity CONSTANT numeric := 100000;
  s   text;
  m   text[];
  qty numeric;
  u   text;
BEGIN
  IF portion IS NULL THEN
    RETURN jsonb_build_object('quantity', 1, 'unit', 'unit', 'confidence', 'default');
  END IF;

  s := lower(btrim(portion));
  IF s = '' THEN
    RETURN jsonb_build_object('quantity', 1, 'unit', 'unit', 'confidence', 'default');
  END IF;

  -- Rule 1: parenthesised mass/volume hint. Beats the leading number.
  m := regexp_match(s, '\(\s*([0-9]+(?:\.[0-9]+)?)\s*(kg|mg|g|ml|l)\s*\)');
  IF m IS NULL THEN
    -- Rule 2: leading number immediately followed by a mass/volume unit.
    m := regexp_match(s, '^([0-9]+(?:\.[0-9]+)?)\s*(kg|mg|g|ml|l)(?![a-z])');
  END IF;

  IF m IS NOT NULL THEN
    qty := m[1]::numeric;
    u   := m[2];
    IF u = 'kg' THEN qty := qty * 1000; u := 'g';
    ELSIF u = 'mg' THEN qty := qty / 1000; u := 'g';
    ELSIF u = 'l' THEN qty := qty * 1000; u := 'ml';
    END IF;
    IF qty > 0 AND qty <= max_quantity THEN
      RETURN jsonb_build_object('quantity', qty, 'unit', u, 'confidence', 'high');
    END IF;
    RETURN jsonb_build_object('quantity', 1, 'unit', 'unit', 'confidence', 'low');
  END IF;

  -- Rule 3: fractions are not supported; do not silently drop the numerator.
  IF s ~ '[0-9]\s*/\s*[0-9]' THEN
    RETURN jsonb_build_object('quantity', 1, 'unit', 'unit', 'confidence', 'low');
  END IF;

  -- Rule 4: a leading count, terminated by whitespace or end of string.
  m := regexp_match(s, '^([0-9]+(?:\.[0-9]+)?)(?:\s|$)');
  IF m IS NOT NULL THEN
    qty := m[1]::numeric;
    IF qty > 0 AND qty <= max_quantity THEN
      RETURN jsonb_build_object('quantity', qty, 'unit', 'unit', 'confidence', 'medium');
    END IF;
  END IF;

  -- Rule 5: give up safely.
  RETURN jsonb_build_object('quantity', 1, 'unit', 'unit', 'confidence', 'low');
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. The additive columns.
-- ----------------------------------------------------------------------------
ALTER TABLE public.nutrition_logs ADD COLUMN IF NOT EXISTS items jsonb;
ALTER TABLE public.custom_dishes  ADD COLUMN IF NOT EXISTS items jsonb;

COMMENT ON COLUMN public.nutrition_logs.items IS
  'Level-2 component breakdown. NULL means this log is a leaf, not a parent. '
  'Never store [] — use NULL. Each element: '
  '{id,name,quantity,unit,displayPortion,calories,protein,carbs,fat,fiber}.';

COMMENT ON COLUMN public.custom_dishes.items IS
  'Level-2 component breakdown. NULL means this dish has no breakdown. '
  'Authoritative; supersedes the legacy `ingredients` text column.';

-- D-16: `ingredients` is kept this release. It is what makes the migration
-- reversible and what keeps an un-updated Android client working.
COMMENT ON COLUMN public.custom_dishes.ingredients IS
  'DEPRECATED — superseded by custom_dishes.items (jsonb). Retained for '
  'provenance and rollback. Do not write to this column from new code.';

-- ----------------------------------------------------------------------------
-- 4. Shape constraint on both tables.
--    Written as one self-contained expression: PostgreSQL evaluates a table''s
--    CHECK constraints in constraint-name order and raises on the first
--    failure, so a constraint that assumes a sibling already rejected
--    non-arrays produces `cannot get array length of a non-array` instead of a
--    clean violation, depending purely on how the names happen to sort.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_nl_items_shape' AND conrelid = 'public.nutrition_logs'::regclass
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT chk_nl_items_shape CHECK (
        items IS NULL OR (
              jsonb_typeof(items) = 'array'
          AND jsonb_array_length(items) BETWEEN 1 AND 50
          AND private.items_min_macro(items) >= 0
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cd_items_shape' AND conrelid = 'public.custom_dishes'::regclass
  ) THEN
    ALTER TABLE public.custom_dishes
      ADD CONSTRAINT chk_cd_items_shape CHECK (
        items IS NULL OR (
              jsonb_typeof(items) = 'array'
          AND jsonb_array_length(items) BETWEEN 1 AND 50
          AND private.items_min_macro(items) >= 0
        )
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Backfill custom_dishes.items from the legacy `ingredients` text blob.
--
--    nutrition_logs gets NO backfill: the table has no `ingredients` column and
--    no other source of component data, so all existing rows stay items IS NULL
--    (level-2 leaves), which is exactly what they are.
--
--    Guard semantics, validated against all 7 production dishes plus 10 hostile
--    shapes: NULL / blank / non-JSON / JSON object / JSON scalar / truncated
--    JSON / empty array all yield NULL (no backfill). Only a non-empty JSON
--    array backfills.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.safe_items_array(txt text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE v jsonb;
BEGIN
  IF txt IS NULL OR btrim(txt) = '' THEN RETURN NULL; END IF;
  BEGIN
    v := txt::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;   -- per-row subtransaction: one bad row cannot abort the batch
  END;
  IF jsonb_typeof(v) <> 'array' THEN RETURN NULL; END IF;
  IF jsonb_array_length(v) = 0 THEN RETURN NULL; END IF;
  RETURN v;
END;
$$;

-- Read one macro key as a number, coercing anything that is not a JSON number
-- to 0. Without this, a value like "lots" raises
-- `invalid input syntax for type numeric` from inside the expression.
CREATE OR REPLACE FUNCTION private.num_or_zero(obj jsonb, key text)
RETURNS numeric
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN jsonb_typeof(obj -> key) = 'number'
              THEN (obj ->> key)::numeric ELSE 0 END
$$;

-- Build the canonical items array for one legacy ingredients blob.
-- Never rounds. Clamps every macro with GREATEST(x, 0) (R-08). Preserves the
-- original portion string verbatim into displayPortion, always (R-10 escape
-- hatch), even when the converter could not interpret it.
CREATE OR REPLACE FUNCTION private.items_from_ingredients(dish_id uuid, dish_name text, txt text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$
  WITH src AS (SELECT private.safe_items_array(txt) AS arr)
  SELECT CASE WHEN (SELECT arr FROM src) IS NULL THEN NULL ELSE (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',             'bf-' || dish_id::text || '-' || (e.ord - 1)::text,
        'name',           COALESCE(NULLIF(e.val ->> 'name', ''), dish_name),
        'quantity',       (private.portion_to_canonical(e.val ->> 'portion') ->> 'quantity')::numeric,
        'unit',           private.portion_to_canonical(e.val ->> 'portion') ->> 'unit',
        'displayPortion', e.val ->> 'portion',
        'calories',       GREATEST(private.num_or_zero(e.val, 'calories'), 0),
        'protein',        GREATEST(private.num_or_zero(e.val, 'protein'),  0),
        'carbs',          GREATEST(private.num_or_zero(e.val, 'carbs'),    0),
        'fat',            GREATEST(private.num_or_zero(e.val, 'fat'),      0),
        'fiber',          GREATEST(private.num_or_zero(e.val, 'fiber'),    0)
      )
      ORDER BY e.ord
    )
    FROM jsonb_array_elements((SELECT arr FROM src)) WITH ORDINALITY AS e(val, ord)
    WHERE jsonb_typeof(e.val) = 'object'
  ) END
$$;

UPDATE public.custom_dishes cd
   SET items = private.items_from_ingredients(cd.id, cd.name, cd.ingredients)
 WHERE cd.items IS NULL
   AND private.items_from_ingredients(cd.id, cd.name, cd.ingredients) IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. PostgREST schema cache. pgrst_ddl_watch normally handles this; belt and
--    braces so a client cannot see PGRST204 for a column that exists.
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
