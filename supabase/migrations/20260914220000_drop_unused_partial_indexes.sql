-- ============================================================================
-- Migration: 20260914220000_drop_unused_partial_indexes.sql
-- Index Optimization: Drop Unused Partial Indexes
-- Description: Drop unused partial indexes on routine_templates that introduced
--              write amplification without planner adoption.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_routine_templates_is_master;
DROP INDEX IF EXISTS public.idx_routine_templates_assigned_to;

NOTIFY pgrst, 'reload schema';
