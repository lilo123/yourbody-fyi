-- ============================================================================
-- Yourbody — Rollback Sync User Email from auth.users to public.users
-- Reverses 20261011020000_sync_user_email.sql
-- ============================================================================

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
DROP FUNCTION IF EXISTS public.sync_user_email();

NOTIFY pgrst, 'reload schema';
