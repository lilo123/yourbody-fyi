-- ============================================================================
-- Index Coverage Optimization
-- Migration: 20260914150000_index_coverage_optimization.sql
-- Description: Adds missing critical performance indexes for hot query paths:
--   1. sets(workout_id, created_at ASC) - Eliminates in-memory sort on workout sets
--   2. routine_templates(is_master) WHERE is_master = true - Enables BitmapOr on template disjunction
--   3. routine_templates(assigned_to) WHERE assigned_to IS NOT NULL - Enables BitmapOr on template disjunction
--   4. custom_dishes(user_id, created_at DESC) - Optimizes custom dishes listing
--   5. coach_athlete_links(coach_id, linked_at DESC) WHERE status = 'active' - Optimizes active roster listing
-- ============================================================================

-- 1. Composite index for sets by workout with chronological ordering
CREATE INDEX IF NOT EXISTS idx_sets_workout_created ON public.sets (workout_id, created_at ASC);

-- 2. Partial indexes for routine templates disjunction (user_id OR is_master OR assigned_to)
CREATE INDEX IF NOT EXISTS idx_routine_templates_is_master ON public.routine_templates (is_master) WHERE is_master = true;
CREATE INDEX IF NOT EXISTS idx_routine_templates_assigned_to ON public.routine_templates (assigned_to) WHERE assigned_to IS NOT NULL;

-- 3. Composite index for custom dishes by user with reverse-chronological ordering
CREATE INDEX IF NOT EXISTS idx_custom_dishes_user_created ON public.custom_dishes (user_id, created_at DESC);

-- 4. Partial index for active coach athlete links with reverse-chronological ordering
CREATE INDEX IF NOT EXISTS idx_cal_coach_linked ON public.coach_athlete_links (coach_id, linked_at DESC) WHERE status = 'active';

NOTIFY pgrst, 'reload schema';
