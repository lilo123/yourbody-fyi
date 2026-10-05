-- ============================================================================
-- Migration: Add kind, use_count, notes to custom_dishes and notes to nutrition_logs
-- Phase 4.1 / 4.2 schema expansion
-- ============================================================================

-- 1. custom_dishes.kind
-- 'food' | 'recipe', NOT NULL, with a CHECK constraining it to those two values.
-- Default is 'food' because custom entries represent atomic foods by default
-- unless explicitly composed as multi-item recipes.
ALTER TABLE public.custom_dishes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'food';

-- 2. Backfill kind on custom_dishes:
-- 'recipe' where the dish has more than one item, 'food' otherwise.
-- items is nullable — a NULL or absent items array evaluates to 'food'.
UPDATE public.custom_dishes
SET kind = CASE
  WHEN items IS NOT NULL
   AND jsonb_typeof(items) = 'array'
   AND jsonb_array_length(items) > 1
  THEN 'recipe'
  ELSE 'food'
END;

-- Enforce CHECK constraint on kind ('food' | 'recipe')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cd_kind' AND conrelid = 'public.custom_dishes'::regclass
  ) THEN
    ALTER TABLE public.custom_dishes
      ADD CONSTRAINT chk_cd_kind CHECK (kind IN ('food', 'recipe'));
  END IF;
END $$;

-- 3. custom_dishes.use_count
-- integer, NOT NULL, DEFAULT 0, with a CHECK that it cannot go negative.
ALTER TABLE public.custom_dishes
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cd_use_count_min_zero' AND conrelid = 'public.custom_dishes'::regclass
  ) THEN
    ALTER TABLE public.custom_dishes
      ADD CONSTRAINT chk_cd_use_count_min_zero CHECK (use_count >= 0);
  END IF;
END $$;

-- 4. custom_dishes.notes
-- Nullable text, max length 500 enforced by CHECK.
ALTER TABLE public.custom_dishes
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cd_notes_max_length' AND conrelid = 'public.custom_dishes'::regclass
  ) THEN
    ALTER TABLE public.custom_dishes
      ADD CONSTRAINT chk_cd_notes_max_length CHECK (notes IS NULL OR length(notes) <= 500);
  END IF;
END $$;

-- 5. nutrition_logs.notes
-- Nullable text, max length 500 enforced by CHECK.
-- Snapshot copy written at log time; deliberately no FK to custom_dishes.
ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_nl_notes_max_length' AND conrelid = 'public.nutrition_logs'::regclass
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT chk_nl_notes_max_length CHECK (notes IS NULL OR length(notes) <= 500);
  END IF;
END $$;

-- Comments
COMMENT ON COLUMN public.custom_dishes.kind IS
  'User-declared dish classification: food (atomic food) or recipe (composed meal). Authoritative.';

COMMENT ON COLUMN public.custom_dishes.use_count IS
  'Total times this custom dish has been logged. Non-negative integer, default 0.';

COMMENT ON COLUMN public.custom_dishes.notes IS
  'Optional user notes or preparation instructions for the custom dish (max 500 characters).';

COMMENT ON COLUMN public.nutrition_logs.notes IS
  'Optional user notes for this logged meal (snapshot copy at log time, max 500 characters).';

NOTIFY pgrst, 'reload schema';
