-- ============================================================================
-- ROLLBACK for 20260914220000_drop_unused_partial_indexes.sql (FIX-10)
-- ----------------------------------------------------------------------------
-- Recreates partial indexes on routine_templates:
--   1. idx_routine_templates_is_master
--   2. idx_routine_templates_assigned_to
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_routine_templates_is_master ON public.routine_templates (is_master) WHERE is_master = true;
CREATE INDEX IF NOT EXISTS idx_routine_templates_assigned_to ON public.routine_templates (assigned_to) WHERE assigned_to IS NOT NULL;

NOTIFY pgrst, 'reload schema';
