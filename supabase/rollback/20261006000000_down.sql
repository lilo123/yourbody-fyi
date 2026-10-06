-- ============================================================================
-- Yourbody — Rollback app_config feature flags
-- Reverses 20261006000000_app_config.sql. Only run after every deployed client
-- has stopped reading app_config (clients fall back to flag defaults if the
-- table is missing, so dropping it disables all server-side flags).
-- ============================================================================

DROP POLICY IF EXISTS "app_config_authenticated_select" ON public.app_config;
DROP TABLE IF EXISTS public.app_config;

NOTIFY pgrst, 'reload schema';
