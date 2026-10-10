-- ============================================================================
-- Yourbody — Rollback AI parse quota
-- Reverses 20261010010000_ai_quota.sql
-- ============================================================================

DROP TRIGGER IF EXISTS trg_protect_user_billing_fields ON public.users;
DROP FUNCTION IF EXISTS public.protect_user_billing_fields();
DROP FUNCTION IF EXISTS public.consume_ai_quota(integer);
DROP FUNCTION IF EXISTS public.ai_plan_for(uuid);
DROP POLICY IF EXISTS "ai_usage_own_rows_select" ON public.ai_usage;
DROP TABLE IF EXISTS public.ai_usage;
ALTER TABLE public.users DROP COLUMN IF EXISTS trial_ends_at;
DELETE FROM public.app_config WHERE key IN ('ai_quota_enabled', 'ai_quota_limits');

NOTIFY pgrst, 'reload schema';
