-- ============================================================================
-- Nutrition hierarchy — has_components discriminator
-- ----------------------------------------------------------------------------
-- Adds a stored generated boolean column to public.nutrition_logs indicating
-- whether the meal log contains 2 or more level-1 components (isLevel1).
--
-- Allows list projections (e.g. /history) to project expandability cheaply
-- without shipping the heavy `items` payload or performing N+1 fan-out queries.
-- ============================================================================

ALTER TABLE public.nutrition_logs
ADD COLUMN has_components boolean
GENERATED ALWAYS AS (
  items IS NOT NULL
  AND jsonb_typeof(items) = 'array'
  AND jsonb_array_length(items) >= 2
) STORED;

COMMENT ON COLUMN public.nutrition_logs.has_components IS
  'True if the meal log has 2 or more components (level 1 / expandable). '
  'Maintained automatically as a stored generated column from items.';

NOTIFY pgrst, 'reload schema';
