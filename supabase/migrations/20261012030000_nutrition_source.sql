-- Additive migration for nutrition source and parser version
-- Public schema nutrition_logs table provenance tracking

ALTER TABLE public.nutrition_logs
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS parser_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_nutrition_logs_source'
  ) THEN
    ALTER TABLE public.nutrition_logs
      ADD CONSTRAINT chk_nutrition_logs_source
      CHECK (source IS NULL OR source IN ('device', 'ai', 'manual'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
