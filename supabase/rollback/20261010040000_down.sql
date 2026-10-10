-- ============================================================================
-- Yourbody — Rollback paywall_enabled feature flag
-- Reverses 20261010040000_paywall_flag.sql.
-- ============================================================================

DELETE FROM public.app_config WHERE key = 'paywall_enabled';

NOTIFY pgrst, 'reload schema';
