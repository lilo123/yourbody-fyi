-- ============================================================================
-- ROLLBACK for 20260914150000_index_coverage_optimization.sql
-- ----------------------------------------------------------------------------
-- Drops indexes added in forward migration:
--   1. idx_sets_workout_created
--   2. idx_routine_templates_is_master
--   3. idx_routine_templates_assigned_to
--   4. idx_custom_dishes_user_created
--   5. idx_cal_coach_linked
--
-- This file is NOT in supabase/migrations/ on purpose — the Supabase CLI
-- applies everything it finds there. Run it by hand:
--   docker exec -i supabase_db_fitness-tracking psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/rollback/20260914150000_down.sql
-- ============================================================================

DROP INDEX IF EXISTS public.idx_sets_workout_created;
DROP INDEX IF EXISTS public.idx_routine_templates_is_master;
DROP INDEX IF EXISTS public.idx_routine_templates_assigned_to;
DROP INDEX IF EXISTS public.idx_custom_dishes_user_created;
DROP INDEX IF EXISTS public.idx_cal_coach_linked;

NOTIFY pgrst, 'reload schema';
