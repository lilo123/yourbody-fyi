-- ============================================================================
-- ROLLBACK for 20260913160000_nutrition_items_hierarchy.sql (Phase 2)
-- ----------------------------------------------------------------------------
-- Restores the exact prior state: both `items` columns and the shape
-- constraints disappear, the deprecation COMMENT on custom_dishes.ingredients
-- is removed, and the `private` helper schema is dropped if it is empty.
--
-- custom_dishes.ingredients was never written to, so no data is lost by
-- rolling back. That is the whole point of D-16.
--
-- This file is NOT in supabase/migrations/ on purpose — the Supabase CLI
-- applies everything it finds there. Run it by hand:
--   docker exec -i supabase_db_fitness-tracking psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/rollback/20260913160000_down.sql
-- Run 20260913170000_down.sql first if Phase 5 has been applied.
-- ============================================================================

ALTER TABLE public.nutrition_logs DROP CONSTRAINT IF EXISTS chk_nl_items_shape;
ALTER TABLE public.custom_dishes  DROP CONSTRAINT IF EXISTS chk_cd_items_shape;

ALTER TABLE public.nutrition_logs DROP COLUMN IF EXISTS items;
ALTER TABLE public.custom_dishes  DROP COLUMN IF EXISTS items;

COMMENT ON COLUMN public.custom_dishes.ingredients IS NULL;

DROP FUNCTION IF EXISTS private.items_from_ingredients(uuid, text, text);
DROP FUNCTION IF EXISTS private.safe_items_array(text);
DROP FUNCTION IF EXISTS private.num_or_zero(jsonb, text);
DROP FUNCTION IF EXISTS private.portion_to_canonical(text);
DROP FUNCTION IF EXISTS private.items_min_macro(jsonb);
DROP FUNCTION IF EXISTS private.items_macro_sum(jsonb, text);

-- Only if nothing else has taken up residence there.
DROP SCHEMA IF EXISTS private RESTRICT;

NOTIFY pgrst, 'reload schema';
