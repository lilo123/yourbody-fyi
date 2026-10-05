-- ============================================================================
-- ROLLBACK for 20260913170000_nutrition_items_integrity.sql (Phase 5)
-- ----------------------------------------------------------------------------
-- Drops the seven constraints Phase 5 adds. The helper functions stay: they are
-- owned by Phase 2 and are still referenced by chk_*_items_shape.
--
-- NOTE: the D-3 reconciliation (Berry Cherry Smoothie fiber 11.9 -> 12.4) is
-- NOT undone. It is a data correction, not a schema change, and reverting it
-- would re-introduce a value the plan established is wrong. If you genuinely
-- need the old number back it is in the Phase 0 snapshot under snapshots/.
-- ============================================================================

ALTER TABLE public.nutrition_logs DROP CONSTRAINT IF EXISTS chk_nl_parent_equals_items_sum;
ALTER TABLE public.custom_dishes  DROP CONSTRAINT IF EXISTS chk_cd_parent_equals_items_sum;

ALTER TABLE public.custom_dishes DROP CONSTRAINT IF EXISTS chk_cd_calories_non_negative;
ALTER TABLE public.custom_dishes DROP CONSTRAINT IF EXISTS chk_cd_protein_non_negative;
ALTER TABLE public.custom_dishes DROP CONSTRAINT IF EXISTS chk_cd_carbs_non_negative;
ALTER TABLE public.custom_dishes DROP CONSTRAINT IF EXISTS chk_cd_fat_non_negative;
ALTER TABLE public.custom_dishes DROP CONSTRAINT IF EXISTS chk_cd_fiber_non_negative;

NOTIFY pgrst, 'reload schema';
